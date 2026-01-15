
import { StorageProvider, FileEntry, VersionEntry, WriteOptions } from './types.js';

interface GitHubContent {
    name: string;
    path: string;
    sha: string;
    size: number;
    url: string;
    html_url: string;
    git_url: string;
    download_url: string;
    type: 'file' | 'dir';
    content?: string;
    encoding?: string;
}

interface GitHubCommit {
    sha: string;
    html_url: string;
    commit: {
        author: {
            name: string;
            date: string;
        };
        message: string;
    };
}

export class GitHubStorageProvider implements StorageProvider {
    name: string;
    private owner: string;
    private repo: string;
    private branch: string;
    private token?: string;
    private baseUrl = 'https://api.github.com';

    // Rate limiting state
    private rateLimitRemaining: number = 5000;
    private rateLimitReset: number = 0;

    constructor(name: string, config: { owner: string; repo: string; branch?: string; token?: string }) {
        this.name = name;
        this.owner = config.owner;
        this.repo = config.repo;
        this.branch = config.branch || 'main';
        this.token = config.token;
    }

    private get headers() {
        const h: Record<string, string> = {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Glint-Storage-Provider'
        };
        if (this.token) {
            h['Authorization'] = `token ${this.token}`;
        }
        return h;
    }

    private updateRateLimit(headers: Headers) {
        const remaining = headers.get('x-ratelimit-remaining');
        const reset = headers.get('x-ratelimit-reset');

        if (remaining) this.rateLimitRemaining = parseInt(remaining, 10);
        if (reset) this.rateLimitReset = parseInt(reset, 10) * 1000;
    }

    private async request<T>(path: string, options: RequestInit = {}, parseJson = true): Promise<T> {
        if (this.rateLimitRemaining === 0 && Date.now() < this.rateLimitReset) {
            throw new Error(`GitHub rate limit exceeded. Resets at ${new Date(this.rateLimitReset).toISOString()}`);
        }

        const url = `${this.baseUrl}/repos/${this.owner}/${this.repo}/${path}`;
        const res = await fetch(url, {
            ...options,
            headers: {
                ...this.headers,
                ...options.headers
            }
        });

        this.updateRateLimit(res.headers);

        if (!res.ok) {
            if (res.status === 404) {
                throw new Error('Not found');
            }
            if (res.status === 409) {
                throw new Error('Conflict');
            }
            const errorBody = await res.text();
            throw new Error(`GitHub API error ${res.status}: ${errorBody}`);
        }

        if (!parseJson) return undefined as any;
        return res.json() as Promise<T>;
    }

    private async getFileSha(path: string): Promise<string | null> {
        try {
            const data = await this.request<GitHubContent>(`contents/${path}?ref=${this.branch}`);
            return data.sha;
        } catch (err: any) {
            if (err.message === 'Not found') return null;
            throw err;
        }
    }

    async read(path: string): Promise<string> {
        const cleanPath = path.replace(/^\/+/, '');
        const data = await this.request<GitHubContent>(`contents/${cleanPath}?ref=${this.branch}`);
        if (data.type !== 'file' || !data.content) {
            throw new Error('Not a file or empty content');
        }
        return Buffer.from(data.content, 'base64').toString('utf-8');
    }

    async readBuffer(path: string): Promise<Buffer> {
        const data = await this.request<GitHubContent>(`contents/${path}?ref=${this.branch}`);
        if (data.type !== 'file' || !data.content) {
            throw new Error('Not a file or empty content');
        }
        return Buffer.from(data.content, 'base64');
    }

    async write(path: string, content: string, options?: WriteOptions): Promise<void> {
        return this._writeInternal(path, Buffer.from(content).toString('base64'), options);
    }

    async writeBuffer(path: string, content: Buffer, options?: WriteOptions): Promise<void> {
        return this._writeInternal(path, content.toString('base64'), options);
    }

    private async _writeInternal(path: string, contentBase64: string, options?: WriteOptions): Promise<void> {
        const cleanPath = path.replace(/^\/+/, '');
        const maxRetries = 3;
        const delays = [100, 200, 300];

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const sha = await this.getFileSha(cleanPath);

                // Check optimistic lock if expectedHash provided
                if (options?.expectedHash && sha && sha !== options.expectedHash) {
                    throw new Error('Conflict: File has been modified by another user');
                }

                const body: any = {
                    message: options?.message || `Update ${path}`,
                    content: contentBase64,
                    branch: this.branch
                };

                // Add author if provided
                if (options?.author) {
                    body.author = options.author;
                }

                if (sha) {
                    body.sha = sha;
                }

                await this.request(`contents/${cleanPath}`, {
                    method: 'PUT',
                    body: JSON.stringify(body)
                });
                return;

            } catch (err: any) {
                if (err.message === 'Conflict' && attempt < maxRetries) {
                    // 409 Conflict - retry with backoff
                    await new Promise(resolve => setTimeout(resolve, delays[attempt]));
                    continue;
                }
                throw err;
            }
        }
    }

    async delete(path: string): Promise<void> {
        const cleanPath = path.replace(/^\/+/, '');
        const sha = await this.getFileSha(cleanPath);
        if (!sha) return; // File doesn't exist, treat as success

        await this.request(`contents/${cleanPath}`, {
            method: 'DELETE',
            body: JSON.stringify({
                message: `Delete ${path}`,
                sha,
                branch: this.branch
            })
        });
    }

    async exists(path: string): Promise<boolean> {
        try {
            await this.request(`contents/${path}?ref=${this.branch}`, { method: 'HEAD' }, false);
            return true;
        } catch (err: any) {
            if (err.message === 'Not found') return false;
            throw err;
        }
    }

    async move(oldPath: string, newPath: string): Promise<void> {
        // GitHub API doesn't have a direct 'move'. We must read, write to new, delete old.
        // This is not atomic, sadly.
        const content = await this.read(oldPath);
        await this.write(newPath, content, {
            message: `Move ${oldPath} to ${newPath}`
        });
        await this.delete(oldPath);
    }

    async list(directory: string): Promise<FileEntry[]> {
        // Clean directory path: remove trailing slash, handle root
        const dirPath = directory === '/' || directory === '' ? '' : `/${directory}`;
        // GitHub contents API doesn't like starting with / for root but likes it for subdirs?
        // Actually, 'contents/' lists root. 'contents/foo' lists foo.
        // Let's strip leading slash.
        const cleanPath = directory.replace(/^\/+/, '').replace(/\/+$/, '');

        try {
            const items = await this.request<GitHubContent[] | GitHubContent>(`contents/${cleanPath}?ref=${this.branch}`);

            if (!Array.isArray(items)) {
                // It's a single file if path points to a file
                return [{
                    name: items.name,
                    path: items.path,
                    type: 'file',
                    size: items.size
                }];
            }

            return items.map(item => ({
                name: item.name,
                path: item.path,
                type: item.type === 'dir' ? 'directory' : 'file',
                size: item.size
            }));
        } catch (err: any) {
            if (err.message === 'Not found') return [];
            throw err;
        }
    }

    async history(path: string): Promise<VersionEntry[]> {
        const commits = await this.request<GitHubCommit[]>(`commits?path=${path}&sha=${this.branch}`);

        return commits.map(c => ({
            sha: c.sha,
            message: c.commit.message,
            author: c.commit.author.name,
            date: new Date(c.commit.author.date),
            url: c.html_url
        }));
    }

    async stat(path: string): Promise<{ size: number; mtime: Date; isDirectory: boolean }> {
        let data: GitHubContent | GitHubContent[];
        try {
            data = await this.request<GitHubContent | GitHubContent[]>(`contents/${path}?ref=${this.branch}`);
        } catch (err: any) {
            if (err.message === 'Not found') {
                throw new Error(`File not found: ${path}`);
            }
            throw err;
        }

        const isArray = Array.isArray(data);
        const isDirectory = isArray || (data as GitHubContent).type === 'dir';
        const size = isArray ? 0 : (data as GitHubContent).size;

        // Get last commit for mtime
        let mtime = new Date();
        try {
            const commits = await this.request<GitHubCommit[]>(`commits?path=${path}&sha=${this.branch}&per_page=1`);
            if (commits && commits.length > 0) {
                mtime = new Date(commits[0].commit.author.date);
            }
        } catch (e) {
            // Ignore commit fetch errors, fallback to now
        }

        return { size, mtime, isDirectory };
    }

    getRateLimitStatus() {
        return {
            remaining: this.rateLimitRemaining,
            reset: this.rateLimitReset
        };
    }

    isFromRepo(owner: string, repo: string): boolean {
        return this.owner === owner && this.repo === repo;
    }
}

// GitHub backend: OAuth or a fine-grained PAT kept only in memory.
import { beginGitHubOAuth, GitHubOAuthConfig } from '../github-oauth.js';
import { z } from 'zod';
import { StorageAdapter, FileMeta, ConflictError, AuthExpiredError } from './types.js';

const API = 'https://api.github.com';

interface CachedRead {
    content: string;
    version: string;
}

const githubListSchema = z.array(z.object({
    type: z.string(),
    name: z.string(),
    path: z.string(),
    sha: z.string(),
}));
const githubReadSchema = z.object({ content: z.string(), sha: z.string() });
const githubMutationSchema = z.object({
    content: z.object({ name: z.string(), path: z.string(), sha: z.string() }),
});
// UTF-8-safe base64 (GitHub Contents API is base64).
function toB64(s: string): string {
    return btoa(String.fromCharCode(...new TextEncoder().encode(s)));
}
function fromB64(b: string): string {
    const bin = atob(b.replace(/\n/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export class GitHubAdapter implements StorageAdapter {
    private token: string | null = null;
    private userName = 'GitHub User';
    private reads = new Map<string, CachedRead>();
    private listedVersions = new Map<string, string>();

    constructor(
        private owner: string,
        private repo: string,
        private path: string,
        private ref: string,
        private oauth?: GitHubOAuthConfig,
        initialToken?: string | null,
    ) {
        this.token = initialToken ?? null;
    }

    async auth(): Promise<void> {
        if (this.token && (await this.validate(this.token))) return;
        if (this.oauth && confirm('GitHub OAuth grants Glint broad “repo” access. Continue to sign in with GitHub? Cancel to use a repository-selected personal access token instead.')) {
            beginGitHubOAuth(this.oauth);
        }
        const pat = prompt(
            'Paste a GitHub fine-grained token with Contents read/write on this repo. It will be kept only until this tab reloads.\\n' +
            'Create one at github.com/settings/tokens'
        );
        const token = pat?.trim();
        if (!token) throw new Error('GitHub token required.');
        if (!(await this.validate(token))) throw new Error('Token is invalid or lacks access to this repo.');
        this.token = token;
    }

    async reauthenticate(): Promise<void> {
        if (!this.token || !(await this.validate(this.token))) {
            throw new AuthExpiredError('GitHub authentication expired');
        }
    }

    private async validate(token: string): Promise<boolean> {
        try {
            const r = await fetch(`${API}/user`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } });
            if (!r.ok) return false;
            const u = await r.json();
            this.userName = u.name || u.login || this.userName;
            return true;
        } catch { return false; }
    }

    identity() { return { name: this.userName }; }

    private gh(path: string, opts: RequestInit = {}): Promise<Response> {
        return fetch(`${API}${path}`, {
            ...opts,
            headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json', ...(opts.headers || {}) },
        });
    }

    private fullPath(name: string): string {
        const root = this.path.replace(/^\/+|\/+$/g, '');
        return root ? (name ? `${root}/${name}` : root) : name;
    }

    private async listDirectory(path: string): Promise<FileMeta[]> {
        const r = await this.gh(`/repos/${this.owner}/${this.repo}/contents/${encodeURI(this.fullPath(path))}?ref=${encodeURIComponent(this.ref)}`);
        if (!r.ok) throw new Error(`GitHub ${r.status}: ${await r.text()}`);
        const items = githubListSchema.parse(await r.json());
        const files: FileMeta[] = [];
        for (const item of items) {
            const relativePath = path ? `${path}/${item.name}` : item.name;
            if (item.type === 'dir') {
                files.push(...await this.listDirectory(relativePath));
            } else if (item.type === 'file' && item.name.endsWith('.md')) {
                files.push({ id: relativePath, name: item.name, path: relativePath, version: item.sha });
            }
        }
        return files;
    }

    async list(): Promise<FileMeta[]> {
        const files = await this.listDirectory('');
        this.listedVersions = new Map(files.map((file) => [file.id, file.version]));
        for (const id of this.reads.keys()) {
            if (!this.listedVersions.has(id)) this.reads.delete(id);
        }
        return files.sort((a, b) => a.path.localeCompare(b.path));
    }

    async read(id: string) {
        const cached = this.reads.get(id);
        const listedVersion = this.listedVersions.get(id);
        if (cached && (!listedVersion || cached.version === listedVersion)) return cached;
        const r = await this.gh(`/repos/${this.owner}/${this.repo}/contents/${encodeURI(this.fullPath(id))}?ref=${encodeURIComponent(this.ref)}`);
        if (!r.ok) throw new Error(`GitHub ${r.status}: ${await r.text()}`);
        const j = githubReadSchema.parse(await r.json());
        const read = { content: fromB64(j.content), version: j.sha };
        this.reads.set(id, read);
        this.listedVersions.set(id, read.version);
        return read;
    }

    async write(id: string, content: string, version: string) {
        const r = await this.gh(`/repos/${this.owner}/${this.repo}/contents/${encodeURI(this.fullPath(id))}`, {
            method: 'PUT',
            body: JSON.stringify({
                message: `Update ${id} via Glint`,
                content: toB64(content),
                sha: version,
                branch: this.ref,
            }),
        });
        if (r.status === 409) throw new ConflictError();
        if (r.status === 401) throw new AuthExpiredError('GitHub authentication expired');
        if (!r.ok) throw new Error(`GitHub ${r.status}: ${await r.text()}`);
        const nextVersion = githubMutationSchema.parse(await r.json()).content.sha;
        this.reads.set(id, { content, version: nextVersion });
        this.listedVersions.set(id, nextVersion);
        return { version: nextVersion };
    }

    async create(name: string, content: string): Promise<FileMeta> {
        const r = await this.gh(`/repos/${this.owner}/${this.repo}/contents/${encodeURI(this.fullPath(name))}`, {
            method: 'PUT',
            body: JSON.stringify({
                message: `Create ${name} via Glint`,
                content: toB64(content),
                branch: this.ref,
            }),
        });
        if (!r.ok) throw new Error(`GitHub ${r.status}: ${await r.text()}`);
        const created = githubMutationSchema.parse(await r.json()).content;
        const file = { id: created.name, name: created.name, path: created.path, version: created.sha };
        this.reads.set(file.id, { content, version: file.version });
        this.listedVersions.set(file.id, file.version);
        return file;
    }

    async delete(id: string): Promise<void> {
        const { version } = await this.read(id);
        const r = await this.gh(`/repos/${this.owner}/${this.repo}/contents/${encodeURI(this.fullPath(id))}`, {
            method: 'DELETE',
            body: JSON.stringify({
                message: `Delete ${id} via Glint`,
                sha: version,
                branch: this.ref,
            }),
        });
        if (!r.ok) throw new Error(`GitHub ${r.status}: ${await r.text()}`);
        this.reads.delete(id);
        this.listedVersions.delete(id);
    }
}

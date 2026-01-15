
import { GlintConfig } from '../config.js';
import { ContentCache } from './cache.js';
import { GitHubStorageProvider } from './github.js';
import { GitStorageProvider } from './git.js';
import { LocalStorageProvider } from './local.js';
import { FileEntry, SearchResult, StorageProvider, VersionEntry, WriteOptions } from './types.js';

export class StorageManager {
    private providers = new Map<string, StorageProvider>();
    private mounts: Array<{ prefix: string; provider: string }> = [];
    private defaultProvider?: string;
    private cache?: ContentCache<{ html: string; mtime: number }>;
    private gitProviders: GitStorageProvider[] = [];

    constructor(config: GlintConfig, contentDir: string) {
        const storageConfig = config.storage;
        this.defaultProvider = storageConfig.default;
        this.mounts = storageConfig.mounts;

        // Initialize cache
        if (storageConfig.cache?.enabled) {
            this.cache = new ContentCache({
                ttl: storageConfig.cache.ttl,
                maxSize: storageConfig.cache.maxSize
            });
        }

        // Initialize providers
        for (const [name, providerConfig] of Object.entries(storageConfig.providers)) {
            if (providerConfig.type === 'local') {
                let basePath = providerConfig.basePath;
                if (basePath === '.') {
                    basePath = contentDir;
                }
                this.providers.set(name, new LocalStorageProvider(name, basePath));
            } else if (providerConfig.type === 'github') {
                const token = providerConfig.token || config.github?.token || process.env.GITHUB_TOKEN;
                this.providers.set(name, new GitHubStorageProvider(name, {
                    ...providerConfig,
                    token
                }));
            } else if (providerConfig.type === 'git') {
                let basePath = providerConfig.basePath;
                if (basePath === '.') {
                    basePath = contentDir;
                }
                const gitProvider = new GitStorageProvider(name, {
                    basePath,
                    autoCommit: providerConfig.autoCommit,
                    autoSync: providerConfig.autoSync,
                    syncInterval: providerConfig.syncInterval,
                    commitMessage: providerConfig.commitMessage
                });
                this.providers.set(name, gitProvider);
                this.gitProviders.push(gitProvider);
            }
        }

        if (this.defaultProvider && !this.providers.has(this.defaultProvider)) {
            throw new Error(`Default storage provider '${this.defaultProvider}' not configured`);
        }
    }

    private resolveProvider(path: string): { provider: StorageProvider; relativePath: string } {
        // Sort mounts by length descending to match longest prefix first
        const sortedMounts = [...this.mounts].sort((a, b) => b.prefix.length - a.prefix.length);

        for (const mount of sortedMounts) {
            // Check for prefix match or exact match (omitting trailing slash)
            if (path.startsWith(mount.prefix)) {
                const providerName = mount.provider;
                const provider = this.providers.get(providerName);
                if (!provider) {
                    throw new Error(`Provider '${providerName}' for mount '${mount.prefix}' not found`);
                }
                const relativePath = path.slice(mount.prefix.length).replace(/^\/+/, '');
                return { provider, relativePath };
            }

            // Handle exact match without trailing slash (e.g. path="docs" matches prefix="docs/")
            if (mount.prefix.endsWith('/') && path === mount.prefix.slice(0, -1)) {
                const providerName = mount.provider;
                const provider = this.providers.get(providerName);
                if (!provider) {
                    throw new Error(`Provider '${providerName}' for mount '${mount.prefix}' not found`);
                }
                return { provider, relativePath: '' };
            }
        }

        if (!this.defaultProvider) {
            throw new Error(`No storage mount found for path '${path}' and no default storage provider configured`);
        }

        const provider = this.providers.get(this.defaultProvider);
        if (!provider) throw new Error(`Default provider '${this.defaultProvider}' not found`);
        return { provider, relativePath: path };
    }

    // Public API delegates to resolved provider

    async read(path: string): Promise<string> {
        const { provider, relativePath } = this.resolveProvider(path);
        return await provider.read(relativePath);
    }

    async readBuffer(path: string): Promise<Buffer> {
        const { provider, relativePath } = this.resolveProvider(path);
        return await provider.readBuffer(relativePath);
    }

    async write(path: string, content: string, options?: WriteOptions): Promise<void> {
        const { provider, relativePath } = this.resolveProvider(path);
        await provider.write(relativePath, content, options);

        // Invalidate cache for this path
        if (this.cache) {
            // We invalidate the full path since that's the cache key
            this.cache.invalidate(path);
        }
    }

    async writeBuffer(path: string, content: Buffer, options?: WriteOptions): Promise<void> {
        const { provider, relativePath } = this.resolveProvider(path);
        await provider.writeBuffer(relativePath, content, options);

        if (this.cache) {
            this.cache.invalidate(path);
        }
    }

    async delete(path: string): Promise<void> {
        const { provider, relativePath } = this.resolveProvider(path);
        await provider.delete(relativePath);
        if (this.cache) this.cache.invalidate(path);
    }

    async exists(path: string): Promise<boolean> {
        try {
            const { provider, relativePath } = this.resolveProvider(path);
            if (await provider.exists(relativePath)) return true;
        } catch { }

        // Check if it's a parent of any mount
        const normalizedPath = path.endsWith('/') ? path : path + '/';
        const isParentOfMount = this.mounts.some(m => m.prefix.startsWith(normalizedPath));
        if (isParentOfMount) return true;

        return false;
    }

    async move(oldPath: string, newPath: string): Promise<void> {
        const oldRes = this.resolveProvider(oldPath);
        const newRes = this.resolveProvider(newPath);

        if (oldRes.provider !== newRes.provider) {
            // Cross-provider move: read from old, write to new, delete old
            const content = await oldRes.provider.read(oldRes.relativePath);
            await newRes.provider.write(newRes.relativePath, content, {
                message: `Move from ${oldPath}`
            });
            await oldRes.provider.delete(oldRes.relativePath);
        } else {
            // Same provider
            await oldRes.provider.move(oldRes.relativePath, newRes.relativePath);
        }

        if (this.cache) {
            this.cache.invalidate(oldPath);
            this.cache.invalidate(newPath);
        }
    }

    async list(path: string): Promise<FileEntry[]> {
        const { provider, relativePath } = this.resolveProvider(path);
        const results = await provider.list(relativePath);

        // Add virtual direct sub-mounts
        const normalizedPath = path === '' || path.endsWith('/') ? path : path + '/';
        const seenNames = new Set(results.map(r => r.name));

        for (const mount of this.mounts) {
            if (mount.prefix.startsWith(normalizedPath) && mount.prefix !== normalizedPath) {
                const remainder = mount.prefix.slice(normalizedPath.length);
                const segments = remainder.split('/');
                const subName = segments[0];

                if (subName && !seenNames.has(subName)) {
                    results.push({
                        name: subName,
                        path: normalizedPath + subName,
                        type: 'directory',
                        size: 0,
                        mtime: new Date()
                    });
                    seenNames.add(subName);
                }
            }
        }

        return results;
    }

    async history(path: string): Promise<VersionEntry[]> {
        const { provider, relativePath } = this.resolveProvider(path);
        if (provider.history) {
            return await provider.history(relativePath);
        }
        return [];
    }

    async stat(path: string): Promise<{ size: number; mtime: Date; isDirectory: boolean }> {
        try {
            const { provider, relativePath } = this.resolveProvider(path);
            return await provider.stat(relativePath);
        } catch (err) {
            // If provider stat fails, check if it's a virtual mount directory
            const normalizedPath = path.endsWith('/') ? path : path + '/';
            const isParentOfMount = this.mounts.some(m => m.prefix.startsWith(normalizedPath));
            if (isParentOfMount) {
                return {
                    size: 0,
                    mtime: new Date(),
                    isDirectory: true
                };
            }
            throw err;
        }
    }

    watch(path: string, listener: (event: 'change' | 'rename', filename: string) => void): () => void {
        const { provider, relativePath } = this.resolveProvider(path);
        if (provider.watch) {
            return provider.watch(relativePath, listener);
        }
        return () => { };
    }

    // Git Operations (delegated to default provider for now)

    async getGitStatus() {
        if (!this.defaultProvider) {
            throw new Error('Git operations require a default storage provider');
        }
        const provider = this.providers.get(this.defaultProvider);
        if (provider && provider.getGitStatus) {
            return await provider.getGitStatus();
        }
        throw new Error('Git operations not supported by current storage provider');
    }

    async gitSync() {
        if (!this.defaultProvider) {
            throw new Error('Git operations require a default storage provider');
        }
        const provider = this.providers.get(this.defaultProvider);
        if (provider && provider.gitSync) {
            return await provider.gitSync();
        }
        throw new Error('Git operations not supported by current storage provider');
    }

    async gitPull() {
        if (!this.defaultProvider) {
            throw new Error('Git operations require a default storage provider');
        }
        const provider = this.providers.get(this.defaultProvider);
        if (provider && provider.gitPull) {
            return await provider.gitPull();
        }
        throw new Error('Git operations not supported by current storage provider');
    }

    async gitPush() {
        if (!this.defaultProvider) {
            throw new Error('Git operations require a default storage provider');
        }
        const provider = this.providers.get(this.defaultProvider);
        if (provider && provider.gitPush) {
            return await provider.gitPush();
        }
        throw new Error('Git operations not supported by current storage provider');
    }

    // Cache methods

    getCachedHtml(path: string): { html: string; mtime: number } | undefined {
        return this.cache?.get(path);
    }

    setCachedHtml(path: string, data: { html: string; mtime: number }): void {
        this.cache?.set(path, data);
    }

    invalidateCache(path: string): void {
        this.cache?.invalidate(path);
    }

    clearCache(): void {
        this.cache?.clear();
    }

    invalidateByRepo(owner: string, repo: string, files: string[]): void {
        if (!this.cache) return;

        // Find all mounts that point to this repo
        for (const mount of this.mounts) {
            const provider = this.providers.get(mount.provider);
            if (provider instanceof GitHubStorageProvider && provider.isFromRepo(owner, repo)) {
                // Invalidate each changed file in the cache with the correct prefix
                for (const file of files) {
                    this.cache.invalidate(mount.prefix + file);
                }
            }
        }

        // Also check default provider if it's a GitHub provider
        if (this.defaultProvider) {
            const defaultProvider = this.providers.get(this.defaultProvider);
            if (defaultProvider instanceof GitHubStorageProvider && defaultProvider.isFromRepo(owner, repo)) {
                for (const file of files) {
                    this.cache.invalidate(file);
                }
            }
        }
    }

    /**
     * Start auto-sync for all git providers.
     * Should be called after server initialization.
     */
    async startGitSync(): Promise<void> {
        for (const provider of this.gitProviders) {
            await provider.startSync();
        }
    }

    /**
     * Stop all git provider sync loops.
     * Should be called during server shutdown.
     */
    shutdown(): void {
        for (const provider of this.gitProviders) {
            provider.stopSync();
        }
    }
}

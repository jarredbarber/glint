
import { GlintConfig } from '../config.js';
import { ContentCache } from './cache.js';
import { GitHubStorageProvider } from './github.js';
import { LocalStorageProvider } from './local.js';
import { FileEntry, SearchResult, StorageProvider, VersionEntry, WriteOptions } from './types.js';

export class StorageManager {
    private providers = new Map<string, StorageProvider>();
    private mounts: Array<{ prefix: string; provider: string }> = [];
    private defaultProvider: string;
    private cache?: ContentCache<{ html: string; mtime: number }>;

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
                // If basePath is relative, resolve it relative to contentDir
                // But for safety, local provider logic handles resolving.
                // We just pass it through, but we might want to default to contentDir if '.' is passed?
                // The config schema default is '.', so let's treat that as contentDir.
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
            }
        }

        if (!this.providers.has(this.defaultProvider)) {
            throw new Error(`Default storage provider '${this.defaultProvider}' not configured`);
        }
    }

    private resolveProvider(path: string): { provider: StorageProvider; relativePath: string } {
        // Sort mounts by length descending to match longest prefix first
        const sortedMounts = [...this.mounts].sort((a, b) => b.prefix.length - a.prefix.length);

        for (const mount of sortedMounts) {
            if (path.startsWith(mount.prefix)) {
                const providerName = mount.provider;
                const provider = this.providers.get(providerName);
                if (!provider) {
                    throw new Error(`Provider '${providerName}' for mount '${mount.prefix}' not found`);
                }
                const relativePath = path.slice(mount.prefix.length);
                return { provider, relativePath };
            }
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

    async write(path: string, content: string, options?: WriteOptions): Promise<void> {
        const { provider, relativePath } = this.resolveProvider(path);
        await provider.write(relativePath, content, options);

        // Invalidate cache for this path
        if (this.cache) {
            // We invalidate the full path since that's the cache key
            this.cache.invalidate(path);
        }
    }

    async delete(path: string): Promise<void> {
        const { provider, relativePath } = this.resolveProvider(path);
        await provider.delete(relativePath);
        if (this.cache) this.cache.invalidate(path);
    }

    async exists(path: string): Promise<boolean> {
        const { provider, relativePath } = this.resolveProvider(path);
        return await provider.exists(relativePath);
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
        return await provider.list(relativePath);
    }

    async history(path: string): Promise<VersionEntry[]> {
        const { provider, relativePath } = this.resolveProvider(path);
        if (provider.history) {
            return await provider.history(relativePath);
        }
        return [];
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
}

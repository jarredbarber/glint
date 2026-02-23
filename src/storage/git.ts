/**
 * Git-backed storage provider.
 * Combines fast local filesystem access with automatic git synchronization.
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import {
    StorageProvider,
    FileEntry,
    WriteOptions,
    BatchWriteItem,
    GitStatus,
    GitSyncResult,
    GitPullResult,
    GitPushResult
} from './types.js';
import * as gitUtils from './git-utils.js';

export interface GitProviderConfig {
    basePath: string;
    autoCommit?: boolean;
    autoSync?: boolean;
    syncInterval?: number;
    commitMessage?: string;
}

export class GitStorageProvider implements StorageProvider {
    name: string;
    private basePath: string;
    private autoCommit: boolean;
    private autoSync: boolean;
    private syncInterval: number;
    private commitMessage: string;

    private syncTimer?: ReturnType<typeof setInterval>;
    private commitTimer?: ReturnType<typeof setTimeout>;
    private pendingCommit = false;
    private onError?: (error: Error) => void;

    constructor(name: string, config: GitProviderConfig, onError?: (error: Error) => void) {
        this.name = name;
        this.basePath = path.resolve(config.basePath);
        this.autoCommit = config.autoCommit ?? true;
        this.autoSync = config.autoSync ?? true;
        this.syncInterval = (config.syncInterval ?? 60) * 1000; // Convert to ms
        this.commitMessage = config.commitMessage ?? 'Glint auto-save';
        this.onError = onError;
    }

    private resolvePath(relativePath: string): string {
        const resolved = path.resolve(this.basePath, relativePath);
        if (resolved !== this.basePath && !resolved.startsWith(this.basePath + path.sep)) {
            throw new Error('Access denied: Path outside base directory');
        }
        return resolved;
    }

    // File operations (same as LocalStorageProvider)

    async read(filePath: string): Promise<string> {
        const fullPath = this.resolvePath(filePath);
        return await fs.readFile(fullPath, 'utf-8');
    }

    async readBuffer(filePath: string): Promise<Buffer> {
        const fullPath = this.resolvePath(filePath);
        return await fs.readFile(fullPath);
    }

    async write(filePath: string, content: string, options?: WriteOptions): Promise<void> {
        const fullPath = this.resolvePath(filePath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content, 'utf-8');

        if (this.autoCommit) {
            this.scheduleCommit();
        }
    }

    async writeBuffer(filePath: string, content: Buffer, options?: WriteOptions): Promise<void> {
        const fullPath = this.resolvePath(filePath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content);

        if (this.autoCommit) {
            this.scheduleCommit();
        }
    }

    async delete(filePath: string): Promise<void> {
        const fullPath = this.resolvePath(filePath);
        await fs.unlink(fullPath);

        if (this.autoCommit) {
            this.scheduleCommit();
        }
    }

    async exists(filePath: string): Promise<boolean> {
        try {
            const fullPath = this.resolvePath(filePath);
            await fs.access(fullPath);
            return true;
        } catch {
            return false;
        }
    }

    async move(oldPath: string, newPath: string): Promise<void> {
        const fullOldPath = this.resolvePath(oldPath);
        const fullNewPath = this.resolvePath(newPath);
        await fs.mkdir(path.dirname(fullNewPath), { recursive: true });
        await fs.rename(fullOldPath, fullNewPath);

        if (this.autoCommit) {
            this.scheduleCommit();
        }
    }

    async stat(filePath: string): Promise<{ size: number; mtime: Date; isDirectory: boolean }> {
        const fullPath = this.resolvePath(filePath);
        const stats = await fs.stat(fullPath);
        return {
            size: stats.size,
            mtime: stats.mtime,
            isDirectory: stats.isDirectory()
        };
    }

    async list(directory: string): Promise<FileEntry[]> {
        const fullPath = this.resolvePath(directory);
        const entries = await fs.readdir(fullPath, { withFileTypes: true });

        const results: FileEntry[] = [];

        for (const entry of entries) {
            if (entry.name.startsWith('.')) continue;

            const entryPath = path.join(directory, entry.name);
            const entryFullPath = path.join(fullPath, entry.name);
            const stats = await fs.stat(entryFullPath);

            results.push({
                name: entry.name,
                path: entryPath,
                type: stats.isDirectory() ? 'directory' : 'file',
                mtime: stats.mtime,
                size: stats.size
            });
        }

        return results;
    }

    // Batch operations

    async batchWrite(items: BatchWriteItem[], options?: WriteOptions): Promise<void> {
        // Write all files first (no individual commits)
        for (const item of items) {
            const fullPath = this.resolvePath(item.path);
            await fs.mkdir(path.dirname(fullPath), { recursive: true });
            await fs.writeFile(fullPath, item.content, 'utf-8');
        }

        // Single atomic commit for all changes
        const message = options?.message || this.commitMessage;
        await gitUtils.gitCommit(this.basePath, message);
    }

    // Auto-commit logic

    private scheduleCommit(): void {
        if (this.pendingCommit) return;

        this.pendingCommit = true;

        // Clear existing timer if any
        if (this.commitTimer) {
            clearTimeout(this.commitTimer);
        }

        // Debounce commits by 2 seconds
        this.commitTimer = setTimeout(async () => {
            try {
                await gitUtils.gitCommit(this.basePath, this.commitMessage);
            } catch (err) {
                console.error('[GitStorageProvider] Auto-commit failed:', err);
                if (this.onError) this.onError(err as Error);
            }
            this.pendingCommit = false;
        }, 2000);
    }

    // Sync loop management

    async startSync(): Promise<void> {
        // Check if repo has remote
        const hasRemote = await gitUtils.hasRemote(this.basePath);

        if (!this.autoSync || !hasRemote) {
            console.log(`[GitStorageProvider] Auto-sync disabled (autoSync=${this.autoSync}, hasRemote=${hasRemote})`);
            return;
        }

        console.log(`[GitStorageProvider] Starting auto-sync every ${this.syncInterval / 1000}s`);

        // Initial sync
        try {
            await this.syncWithRemote();
        } catch (err) {
            console.error('[GitStorageProvider] Initial sync failed:', err);
            if (this.onError) this.onError(err as Error);
        }

        // Periodic sync
        this.syncTimer = setInterval(async () => {
            try {
                await this.syncWithRemote();
            } catch (err) {
                console.error('[GitStorageProvider] Periodic sync failed:', err);
                if (this.onError) this.onError(err as Error);
            }
        }, this.syncInterval);
    }

    stopSync(): void {
        if (this.syncTimer) {
            clearInterval(this.syncTimer);
            this.syncTimer = undefined;
        }
        if (this.commitTimer) {
            clearTimeout(this.commitTimer);
            this.commitTimer = undefined;
        }
    }

    private async syncWithRemote(): Promise<void> {
        const result = await gitUtils.gitSync(this.basePath, this.commitMessage);

        if (!result.success) {
            console.error('[GitStorageProvider] Sync error:', result.error);
            if (this.onError && result.error) this.onError(new Error(result.error));
        } else if (result.pulledChanges || result.pushedChanges) {
            console.log('[GitStorageProvider] Sync:', result.messages.join(', '));
        }
    }

    // Git operations - delegated to git-utils

    async getGitStatus(): Promise<GitStatus> {
        return gitUtils.getGitStatus(this.basePath);
    }

    async gitSync(): Promise<GitSyncResult> {
        return gitUtils.gitSync(this.basePath, this.commitMessage);
    }

    async gitPull(): Promise<GitPullResult> {
        return gitUtils.gitPull(this.basePath);
    }

    async gitPush(): Promise<GitPushResult> {
        return gitUtils.gitPush(this.basePath);
    }

    watch(pathPattern: string, listener: (event: 'change' | 'rename', filename: string) => void): () => void {
        const fullPath = this.resolvePath(pathPattern);
        const watcher = fsSync.watch(fullPath, { recursive: true }, (event, filename) => {
            if (filename) {
                listener(event, filename.toString());
            }
        });

        return () => watcher.close();
    }
}

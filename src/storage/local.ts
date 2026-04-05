
import fs from 'node:fs/promises';
import path from 'node:path';
import chokidar from 'chokidar';
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

export class LocalStorageProvider implements StorageProvider {
    name: string;
    private basePath: string;

    constructor(name: string, basePath: string) {
        this.name = name;
        this.basePath = path.resolve(basePath);
    }

    private resolvePath(relativePath: string): string {
        // Prevent directory traversal
        const resolved = path.resolve(this.basePath, relativePath);
        if (resolved !== this.basePath && !resolved.startsWith(this.basePath + path.sep)) {
            throw new Error('Access denied: Path outside base directory');
        }
        return resolved;
    }

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
        // Note: Local provider ignores message and author from options
        // expectedHash checking not implemented for local provider
    }

    async writeBuffer(filePath: string, content: Buffer, options?: WriteOptions): Promise<void> {
        const fullPath = this.resolvePath(filePath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content);
    }

    async delete(filePath: string): Promise<void> {
        const fullPath = this.resolvePath(filePath);
        await fs.unlink(fullPath);
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
            // Skip hidden files/dirs (starting with .)
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
        // Write all files first
        for (const item of items) {
            const fullPath = this.resolvePath(item.path);
            await fs.mkdir(path.dirname(fullPath), { recursive: true });
            await fs.writeFile(fullPath, item.content, 'utf-8');
        }

        // Single git commit for all changes if message provided
        if (options?.message) {
            try {
                await gitUtils.gitCommit(this.basePath, options.message);
            } catch {
                // Ignore commit errors - may not be a git repo
            }
        }
    }

    // Git Operations - delegated to git-utils

    async getGitStatus(): Promise<GitStatus> {
        return gitUtils.getGitStatus(this.basePath);
    }

    async gitSync(): Promise<GitSyncResult> {
        return gitUtils.gitSync(this.basePath);
    }

    async gitPull(): Promise<GitPullResult> {
        return gitUtils.gitPull(this.basePath);
    }

    async gitPush(): Promise<GitPushResult> {
        return gitUtils.gitPush(this.basePath);
    }


    watch(pathPattern: string, listener: (event: 'change' | 'rename', filename: string) => void): () => void {
        const fullPath = this.resolvePath(pathPattern);
        const watcher = chokidar.watch(fullPath, {
            ignoreInitial: true,
            ignored: /(^|[\/\\])\./,  // ignore dotfiles
            persistent: true
        });

        watcher.on('all', (eventType, filePath) => {
            const relative = path.relative(fullPath, filePath);
            if (relative) {
                const event = (eventType === 'add' || eventType === 'unlink' || eventType === 'addDir' || eventType === 'unlinkDir') ? 'rename' : 'change';
                listener(event, relative);
            }
        });

        return () => { watcher.close(); };
    }
}

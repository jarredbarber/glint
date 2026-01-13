
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import {
    StorageProvider,
    FileEntry,
    WriteOptions,
    GitStatus,
    GitSyncResult,
    GitPullResult,
    GitPushResult
} from './types.js';

const execAsync = promisify(exec);

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
        if (!resolved.startsWith(this.basePath)) {
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
                type: entry.isDirectory() ? 'directory' : 'file',
                mtime: stats.mtime,
                size: stats.size
            });
        }

        return results;
    }

    // Git Operations

    private async gitExec(command: string): Promise<string> {
        try {
            const { stdout } = await execAsync(command, {
                cwd: this.basePath,
                timeout: 30000,
            });
            return stdout.trim();
        } catch (error: any) {
            throw new Error(error.stderr || error.message);
        }
    }

    async getGitStatus(): Promise<GitStatus> {
        try {
            await this.gitExec('git rev-parse --git-dir');

            let branch: string | null = null;
            try {
                branch = await this.gitExec('git rev-parse --abbrev-ref HEAD');
            } catch { branch = null; }

            let hasRemote = false;
            try {
                const remotes = await this.gitExec('git remote');
                hasRemote = remotes.trim().length > 0;
            } catch { hasRemote = false; }

            if (hasRemote) {
                try { await this.gitExec('git fetch --quiet'); } catch {}
            }

            let ahead = 0, behind = 0;
            if (branch && hasRemote) {
                try {
                    const revList = await this.gitExec(`git rev-list --left-right --count origin/${branch}...HEAD`);
                    const parts = revList.split('\t');
                    if (parts.length === 2) {
                        behind = parseInt(parts[0]) || 0;
                        ahead = parseInt(parts[1]) || 0;
                    }
                } catch {}
            }

            const status = await this.gitExec('git status --porcelain');
            const hasChanges = status.length > 0;

            return { isRepo: true, branch, ahead, behind, hasChanges, clean: !hasChanges && ahead === 0 };
        } catch (error: any) {
            return { isRepo: false, branch: null, ahead: 0, behind: 0, hasChanges: false, clean: true, message: error.message };
        }
    }

    async gitSync(): Promise<GitSyncResult> {
        const messages: string[] = [];
        let pulledChanges = false, pushedChanges = false;

        try {
            const status = await this.getGitStatus();
            if (!status.isRepo) {
                return { success: false, pulledChanges: false, pushedChanges: false, messages: [], error: 'Not a git repository' };
            }
            if (!status.branch) {
                return { success: false, pulledChanges: false, pushedChanges: false, messages: [], error: 'No branch found' };
            }

            const remotes = await this.gitExec('git remote');
            if (!remotes.trim()) {
                return { success: false, pulledChanges: false, pushedChanges: false, messages: [], error: 'No remote configured' };
            }

            if (status.hasChanges) {
                try {
                    await this.gitExec('git add -A');
                    await this.gitExec(`git commit -m "Auto-sync: ${new Date().toISOString()}"`);
                    messages.push('Committed local changes');
                } catch {}
            }

            try {
                await this.gitExec('git fetch');
                messages.push('Fetched from remote');
            } catch (error: any) {
                return { success: false, pulledChanges: false, pushedChanges: false, messages, error: 'Fetch failed: ' + error.message };
            }

            const updatedStatus = await this.getGitStatus();
            if (updatedStatus.behind > 0) {
                try {
                    await this.gitExec('git pull --ff-only');
                    messages.push('Pulled remote changes');
                    pulledChanges = true;
                } catch (error: any) {
                    if (error.message.includes('Not possible to fast-forward')) {
                        return { success: false, pulledChanges: false, pushedChanges: false, messages, error: 'Merge conflicts detected' };
                    }
                    return { success: false, pulledChanges: false, pushedChanges: false, messages, error: 'Pull failed: ' + error.message };
                }
            }

            const finalStatus = await this.getGitStatus();
            if (finalStatus.ahead > 0) {
                try {
                    await this.gitExec(`git push origin ${status.branch}`);
                    messages.push('Pushed local changes');
                    pushedChanges = true;
                } catch (error: any) {
                    return { success: false, pulledChanges, pushedChanges: false, messages, error: 'Push failed: ' + error.message };
                }
            }

            if (!pulledChanges && !pushedChanges) messages.push('Already up to date');
            return { success: true, pulledChanges, pushedChanges, messages };
        } catch (error: any) {
            return { success: false, pulledChanges, pushedChanges, messages, error: error.message };
        }
    }

    async gitPull(): Promise<GitPullResult> {
        try {
            const status = await this.getGitStatus();
            if (!status.isRepo) throw new Error('Not a git repository');

            const result = await this.gitExec('git pull --ff-only');
            return { success: true, changes: status.behind > 0, message: result || 'Already up to date' };
        } catch (error: any) {
            throw error;
        }
    }

    async gitPush(): Promise<GitPushResult> {
        try {
            const status = await this.getGitStatus();
            if (!status.isRepo) throw new Error('Not a git repository');
            if (!status.branch) throw new Error('No branch to push');

            const result = await this.gitExec(`git push origin ${status.branch}`);
            return { success: true, pushed: status.ahead > 0, message: result || 'Already up to date' };
        } catch (error: any) {
            throw error;
        }
    }

    watch(pathPattern: string, listener: (event: 'change' | 'rename', filename: string) => void): () => void {
        const fullPath = this.resolvePath(pathPattern);
        // fs.watch is not recursive on Linux, but is on macOS/Windows.
        // For now, we rely on native fs.watch.
        // In a real production app, might want to use chokidar.
        const watcher = fsSync.watch(fullPath, { recursive: true }, (event, filename) => {
            if (filename) {
                // Return relative path
                listener(event, filename.toString());
            }
        });

        return () => watcher.close();
    }
}


import fs from 'node:fs/promises';
import path from 'node:path';
import { StorageProvider, FileEntry, WriteOptions } from './types.js';

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

    async write(filePath: string, content: string, options?: WriteOptions): Promise<void> {
        const fullPath = this.resolvePath(filePath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content, 'utf-8');
        // Note: Local provider ignores message and author from options
        // expectedHash checking not implemented for local provider
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
}

import { StorageManager } from '../storage/index.js';
import { parseTaskLine } from './parser.js';
import type { TaskItem, FileTasks } from './types.js';

export class TaskScanner {
    private cache: Map<string, FileTasks> = new Map();
    private storage: StorageManager;

    constructor(storage: StorageManager) {
        this.storage = storage;
    }

    /**
     * Scan all markdown files in the content root.
     */
    async scanAll(): Promise<TaskItem[]> {
        const allTasks: TaskItem[] = [];
        await this.scanDirectory('', allTasks);
        return allTasks;
    }

    private async scanDirectory(dir: string, allTasks: TaskItem[]) {
        try {
            const entries = await this.storage.list(dir);

            for (const entry of entries) {
                // Use POSIX paths
                const relativePath = dir ? `${dir}/${entry.name}` : entry.name;

                if (entry.type === 'directory') {
                    // Skip hidden directories and .assets folders
                    if (entry.name.startsWith('.') || entry.name.endsWith('.assets')) continue;
                    await this.scanDirectory(relativePath, allTasks);
                } else if (entry.type === 'file' && entry.name.endsWith('.md')) {
                    const tasks = await this.scanFile(relativePath);
                    allTasks.push(...tasks);
                }
            }
        } catch (err) {
            console.error(`Error scanning directory ${dir}:`, err);
        }
    }

    private async scanFile(relativePath: string): Promise<TaskItem[]> {
        try {
            const stats = await this.storage.stat(relativePath);
            const mtime = stats.mtime.getTime();

            const cached = this.cache.get(relativePath);
            if (cached && cached.mtime === mtime) {
                return cached.tasks;
            }

            // Read and parse
            const content = await this.storage.read(relativePath);
            const lines = content.split('\n');
            const tasks: TaskItem[] = [];

            lines.forEach((line, index) => {
                const task = parseTaskLine(line, relativePath, index + 1);
                if (task) {
                    tasks.push(task);
                }
            });

            this.cache.set(relativePath, {
                path: relativePath,
                mtime,
                tasks
            });

            return tasks;
        } catch (error) {
            console.error(`Error scanning file ${relativePath}:`, error);
            return [];
        }
    }

    /**
     * Invalidate cache for a specific file.
     * WARNING: This removes the file from cache. Use refresh() to update.
     */
    invalidate(relativePath: string) {
        this.cache.delete(relativePath);
    }

    /**
     * Force re-scan and cache update for a specific file.
     */
    async refresh(relativePath: string): Promise<void> {
        await this.scanFile(relativePath);
    }

    /**
     * Get all currently cached tasks.
     */
    getAllTasks(): TaskItem[] {
        const all: TaskItem[] = [];
        for (const fileTasks of this.cache.values()) {
            all.push(...fileTasks.tasks);
        }
        return all;
    }
}

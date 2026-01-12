import fs from 'fs/promises';
import path from 'path';
import { parseTaskLine } from './parser.js';
import type { TaskItem, FileTasks } from './types.js';
import { resolveContentPath } from '../utils/fs-utils.js';

export class TaskScanner {
    private cache: Map<string, FileTasks> = new Map();
    private contentRoot: string;

    constructor(contentRoot: string) {
        this.contentRoot = contentRoot;
    }

    /**
     * Scan all markdown files in the content root.
     */
    async scanAll(): Promise<TaskItem[]> {
        const allTasks: TaskItem[] = [];
        await this.scanDirectory(this.contentRoot, allTasks);
        return allTasks;
    }

    private async scanDirectory(dir: string, allTasks: TaskItem[]) {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relativePath = path.relative(this.contentRoot, fullPath);

            if (entry.isDirectory()) {
                // Skip hidden directories and .assets folders
                if (entry.name.startsWith('.') || entry.name.endsWith('.assets')) continue;
                await this.scanDirectory(fullPath, allTasks);
            } else if (entry.isFile() && entry.name.endsWith('.md')) {
                const tasks = await this.scanFile(fullPath, relativePath);
                allTasks.push(...tasks);
            }
        }
    }

    private async scanFile(fullPath: string, relativePath: string): Promise<TaskItem[]> {
        try {
            const stats = await fs.stat(fullPath);
            const mtime = stats.mtimeMs;

            const cached = this.cache.get(relativePath);
            if (cached && cached.mtime === mtime) {
                return cached.tasks;
            }

            // Read and parse
            const content = await fs.readFile(fullPath, 'utf-8');
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
        const fullPath = path.join(this.contentRoot, relativePath);
        await this.scanFile(fullPath, relativePath);
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

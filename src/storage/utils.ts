
import path from 'node:path';
import { StorageManager } from './index.js';
import { GlintConfig } from '../config.js';
import { NotFoundError } from '../utils/errors.js';

export interface ResolvedStoragePath {
    path: string;
    stat: { size: number; mtime: Date; isDirectory: boolean };
    isMarkdown: boolean;
}

// Helper to resolve paths using StorageManager (handles .md fallbacks and index files)
export async function resolveStoragePath(storage: StorageManager, urlPath: string, config: GlintConfig): Promise<ResolvedStoragePath> {
    // Normalize path (ensure forward slashes and no leading slash)
    const normalizedPath = urlPath.replace(/^\/+/, '');

    // 1. Try exact path
    try {
        const stat = await storage.stat(normalizedPath);
        if (stat.isDirectory) {
            // It's a directory, look for baseFile
            const indexPath = path.posix.join(normalizedPath, config.baseFile);
            try {
                const indexStat = await storage.stat(indexPath);
                return {
                    path: indexPath,
                    stat: indexStat,
                    isMarkdown: indexPath.endsWith('.md')
                };
            } catch {
                // Index not found
            }
        } else {
            return {
                path: normalizedPath,
                stat,
                isMarkdown: normalizedPath.endsWith('.md')
            };
        }
    } catch {
        // Not found exact
    }

    // 2. Try adding .md
    if (!normalizedPath.endsWith('.md')) {
        const mdPath = normalizedPath + '.md';
        try {
            const stat = await storage.stat(mdPath);
            return {
                path: mdPath,
                stat,
                isMarkdown: true
            };
        } catch {
            // Not found with .md
        }
    }

    throw new NotFoundError('File not found');
}

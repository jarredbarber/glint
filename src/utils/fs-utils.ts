import path from 'node:path';
import fs from 'node:fs/promises';
import { GlintConfig } from '../config.js';
import { ForbiddenError, NotFoundError } from './errors.js';

export interface ResolvedPath {
    safePath: string;
    stats: any | null;
    isMarkdown: boolean;
}

/**
 * Resolves a URL path to a safe, absolute file system path within the content directory.
 * Handles security, .md extension fallback, and directory index mapping.
 */
export async function resolveContentPath(
    contentDir: string,
    urlPath: string,
    config: GlintConfig,
    allowMissing = true
): Promise<ResolvedPath> {
    const normalizedUrlPath = urlPath.replace(/^\/+/, '');
    let safePath = path.resolve(contentDir, normalizedUrlPath);

    // Security: Prevent directory traversal
    if (!safePath.startsWith(contentDir)) {
        throw new ForbiddenError('Directory traversal not allowed');
    }

    let stats: any = null;
    try {
        stats = await fs.stat(safePath);
    } catch (err) {
        // Path doesn't exist as-is
    }

    // Attempt .md fallback if it's not a directory and doesn't exist
    if (!stats || (!stats.isDirectory() && !safePath.endsWith('.md'))) {
        const mdPath = safePath.endsWith('.md') ? safePath : safePath + '.md';
        try {
            const mdStats = await fs.stat(mdPath);
            return {
                safePath: mdPath,
                stats: mdStats,
                isMarkdown: true
            };
        } catch (err) {
            // .md also doesn't exist
        }
    }

    // If it's a directory, try to resolve the index file
    if (stats?.isDirectory()) {
        const indexPath = path.join(safePath, config.baseFile);
        try {
            const indexStats = await fs.stat(indexPath);
            return {
                safePath: indexPath,
                stats: indexStats,
                isMarkdown: indexPath.endsWith('.md')
            };
        } catch (err) {
            // Index file missing in directory
        }
    }

    if (!stats && !allowMissing) {
        throw new NotFoundError('File not found');
    }

    return {
        safePath,
        stats,
        isMarkdown: safePath.endsWith('.md')
    };
}

import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs/promises';
import { LRUCache } from 'lru-cache';

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeStringify from 'rehype-stringify';

import { loadConfig, type GlintConfig } from './config.js';
import { buildFileTree, renderFileTree, type FileNode } from './filetree.js';
import { parseMarkdown } from './markdown.js';
import { preprocessGlintMath } from './remark-glint-math.js';

interface CacheEntry {
    html: string;
    mtime: number;
}

// Image extensions to serve directly
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico'];

function createProcessor(config: GlintConfig) {
    const macros = config['latex-macros'] || {};

    return unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkMath)
        .use(remarkRehype)
        .use(rehypeKatex, { macros })
        .use(rehypeHighlight, { detect: true })
        .use(rehypeSlug)
        .use(rehypeAutolinkHeadings, { behavior: 'wrap' })
        .use(rehypeStringify);
}

const renderHtml = (content: string, title: string, config: GlintConfig, fileTree: FileNode[], currentPath: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <link rel="stylesheet" href="/assets/katex/katex.min.css">
    <link rel="stylesheet" href="/assets/themes/${config.theme}.css">
    <link rel="stylesheet" href="/assets/layout.css">
    <link rel="stylesheet" href="/assets/highlight.css">
</head>
<body>
    <aside class="sidebar">
        <div class="sidebar-header">
            <strong>Files</strong>
        </div>
        <nav class="file-tree">
            <ul>${renderFileTree(fileTree, currentPath)}</ul>
        </nav>
    </aside>
    <main class="content">
        ${content}
    </main>
</body>
</html>
`;

export async function createServer(contentDir: string) {
    const config = await loadConfig(contentDir);
    const assetsDir = path.join(import.meta.dirname, '..', 'assets');
    const processor = createProcessor(config);

    const fastify = Fastify({ logger: true });

    // LRU cache for rendered HTML
    const cache = new LRUCache<string, CacheEntry>({ max: 100 });

    // Serve bundled assets
    fastify.register(fastifyStatic, {
        root: assetsDir,
        prefix: '/assets/',
        decorateReply: false,
    });

    // Serve images from content directory
    fastify.register(fastifyStatic, {
        root: contentDir,
        prefix: '/content/',
        decorateReply: false,
    });

    // Build file tree once at startup
    const fileTree = await buildFileTree(contentDir);

    fastify.get('/*', async (request, reply) => {
        const urlPath = (request.params as { '*': string })['*'] || '';
        let fullPath = path.resolve(contentDir, urlPath);

        // Security: Prevent directory traversal
        if (!fullPath.startsWith(contentDir)) {
            return reply.code(403).send('Forbidden');
        }

        // Check if it's an image request
        const ext = path.extname(fullPath).toLowerCase();
        if (IMAGE_EXTENSIONS.includes(ext)) {
            try {
                const imageBuffer = await fs.readFile(fullPath);
                const mimeTypes: Record<string, string> = {
                    '.png': 'image/png',
                    '.jpg': 'image/jpeg',
                    '.jpeg': 'image/jpeg',
                    '.gif': 'image/gif',
                    '.svg': 'image/svg+xml',
                    '.webp': 'image/webp',
                    '.ico': 'image/x-icon',
                };
                return reply.type(mimeTypes[ext] || 'application/octet-stream').send(imageBuffer);
            } catch {
                return reply.code(404).send('Not Found');
            }
        }

        try {
            // Try to stat the path
            let stats;
            try {
                stats = await fs.stat(fullPath);
            } catch {
                // Path doesn't exist, try with .md extension
                if (!fullPath.endsWith('.md')) {
                    fullPath += '.md';
                    stats = await fs.stat(fullPath);
                } else {
                    throw { code: 'ENOENT' };
                }
            }

            if (stats.isDirectory()) {
                fullPath = path.join(fullPath, config.baseFile);
                stats = await fs.stat(fullPath);
            }

            const mtime = stats.mtimeMs;
            const cached = cache.get(fullPath);

            // Return cached version if mtime hasn't changed
            if (cached && cached.mtime === mtime) {
                return reply.type('text/html').send(cached.html);
            }

            const rawContent = await fs.readFile(fullPath, 'utf-8');
            const { content: mdContent, title: extractedTitle } = parseMarkdown(rawContent);
            const preprocessedContent = preprocessGlintMath(mdContent);
            const result = await processor.process(preprocessedContent);
            const title = extractedTitle || path.basename(fullPath, '.md');
            const html = renderHtml(result.toString(), title, config, fileTree, urlPath);

            // Cache the result
            cache.set(fullPath, { html, mtime });

            reply.type('text/html').send(html);
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
                reply.code(404).send('Not Found');
            } else {
                fastify.log.error(err);
                reply.code(500).send('Internal Server Error');
            }
        }
    });

    return { fastify, config };
}

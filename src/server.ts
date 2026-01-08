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
import { rehypeExtractHeadings, type HeadingNode } from './rehype-extract-headings.js';

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
        .use(remarkMath)
        .use(remarkRehype)
        .use(rehypeKatex, {
            macros,
            trust: true // Enable \htmlClass support
        })
        .use(rehypeHighlight, { detect: true })
        .use(rehypeSlug)
        .use(rehypeAutolinkHeadings, { behavior: 'wrap' })
        .use(rehypeExtractHeadings)
        .use(rehypeStringify);
}

const renderHtml = (content: string, title: string, config: GlintConfig, fileTree: FileNode[], currentPath: string, enableNumbering: boolean, headings: HeadingNode[] = []) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Outfit:wght@500;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/assets/katex/katex.min.css">
    <link rel="stylesheet" href="/assets/themes/${config.theme}.css">
    <link rel="stylesheet" href="/assets/layout.css">
    <link rel="stylesheet" href="/assets/highlight.css">
</head>
<body class="${config.theme} ${enableNumbering ? 'eqn-numbers' : ''}">
    <aside class="sidebar">
        <div class="sidebar-header">
            <strong>Files</strong>
        </div>
        <nav class="file-tree">
            <ul>${renderFileTree(fileTree, currentPath)}</ul>
        </nav>
        
        ${headings.length > 0 ? `
        <div class="sidebar-header" style="margin-top: 2rem;">
            <strong>Outline</strong>
        </div>
        <nav class="outline-tree">
            <ul>
                ${headings.map(h => `
                    <li class="depth-${h.depth}">
                        <a href="#${h.id}">${h.text}</a>
                    </li>
                `).join('')}
            </ul>
        </nav>
        ` : ''}
    </aside>
    <main class="content">
        <div class="content-wrapper">
            ${content}
        </div>
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
            const configData = parseMarkdown(rawContent);
            const mdContent = configData.content;
            const extractedTitle = configData.title;
            const frontmatter = configData.frontmatter || {};

            const preprocessedContent = preprocessGlintMath(mdContent);
            const result = await processor.process(preprocessedContent);
            const title = extractedTitle || path.basename(fullPath, '.md');
            const headings = result.data.headings || [];

            // Equation numbering logic
            const enableNumbering = (frontmatter as any)['eqn-numbers'] === true;

            const html = renderHtml(result.toString(), title, config, fileTree, urlPath, enableNumbering, headings);

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

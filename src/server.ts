import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import path from 'path';
import fs from 'fs/promises';
import { LRUCache } from 'lru-cache';
import crypto from 'crypto';

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
import { remarkMermaidGlint } from './remark-mermaid-glint.js';
import { remarkWikiLinkGlint } from './remark-wiki-link-glint.js';
import { remarkSlashCheckbox } from './remark-slash-checkbox.js';
import { rehypeSourceLines } from './rehype-source-lines.js';
import { VFile } from 'vfile';

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
        .use(remarkGfm) // Support GFM (tables, autolink literals, strikethrough, tasklists)
        .use(remarkSlashCheckbox) // Support [/] syntax
        .use(remarkWikiLinkGlint) // Resolve [[links]] early
        .use(remarkMermaidGlint) // Transform mermaid before math/rehype
        .use(remarkMath)
        .use(remarkRehype, { allowDangerousHtml: true }) // Allow div.mermaid injection
        .use(rehypeKatex, {
            macros,
            trust: true // Enable \htmlClass support
        })
        .use(rehypeHighlight, { detect: true })
        .use(rehypeSlug)
        .use(rehypeAutolinkHeadings, { behavior: 'wrap' })
        .use(rehypeExtractHeadings)
        .use(rehypeSourceLines)
        .use(rehypeStringify, { allowDangerousHtml: true });
}

const renderHead = (title: string, theme: string) => `
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Outfit:wght@500;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/assets/katex/katex.min.css">
    <link rel="stylesheet" href="/assets/themes/${theme}.css">
    <link rel="stylesheet" href="/assets/layout.css">
    <link rel="stylesheet" href="/assets/highlight.css">
    <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
</head>
`;

const renderSidebar = (fileTree: FileNode[], currentPath: string, headings: HeadingNode[] = [], currentTheme: string = 'everforest-dark') => {
    const themes = ['default', 'everforest-dark', 'nord', 'gruvbox-dark', 'catppuccin-mocha', 'solarized-light'];

    return `
<aside class="sidebar">
    <div class="sidebar-scrollable">
        <div class="sidebar-branding">
            <a href="/">
                <img src="/assets/logo.png" alt="glint" class="sidebar-logo">
            </a>
        </div>
        <details open class="sidebar-section">
            <summary class="sidebar-header">Files</summary>
            <nav class="file-tree">
                <ul>${renderFileTree(fileTree, currentPath)}</ul>
            </nav>
        </details>
        
        ${headings.length > 0 ? `
        <details open class="sidebar-section" style="margin-top: 1rem;">
            <summary class="sidebar-header">Outline</summary>
            <nav class="outline-tree">
                <ul>
                    ${headings.map(h => `
                        <li class="depth-${h.depth}">
                            <a href="#${h.id}">${h.text}</a>
                        </li>
                    `).join('')}
                </ul>
            </nav>
        </details>
        ` : ''}
    </div>
    <footer class="sidebar-footer">
        <select class="theme-select" onchange="fetch('/api/theme', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme: this.value }) })">
            ${themes.map(t => `<option value="${t}" ${t === currentTheme ? 'selected' : ''}>${t.replace('-', ' ')}</option>`).join('')}
        </select>
    </footer>
</aside>
`;
};

const renderScripts = () => `
<script>
    document.addEventListener('DOMContentLoaded', function() {
        if (typeof mermaid !== 'undefined') {
            mermaid.initialize({
                startOnLoad: true,
                theme: 'dark',
                securityLevel: 'loose',
                themeVariables: {
                    fontFamily: '"Inter", sans-serif',
                    primaryColor: '#a7c080',
                    primaryTextColor: '#2d353b',
                    primaryBorderColor: '#a7c080',
                    lineColor: '#d3c6aa',
                    secondaryColor: '#dbbc7f',
                    tertiaryColor: '#e67e80'
                }
            });
        }
    });

    // Hot Reloading
    const evtSource = new EventSource("/events");
    let isUnloading = false;

    window.addEventListener('beforeunload', () => {
        isUnloading = true;
        evtSource.close();
    });

    evtSource.onmessage = (event) => {
        if (event.data === "reload") {
            // Check if a client-side refresh just happened (suppress SSE reload)
            const suppressTime = sessionStorage.getItem('glint-suppress-reload');
            if (suppressTime && Date.now() - parseInt(suppressTime) < 3000) {
                console.log("SSE reload suppressed (client-side refresh in progress)");
                sessionStorage.removeItem('glint-suppress-reload');
                return;
            }
            console.log("Config changed, reloading...");
            window.location.reload();
        }
    };
    evtSource.onerror = () => {
        // SSE connection errors are normal during navigation, don't reload
        console.debug('SSE connection error');
    };
</script>
<script src="/assets/router.bundle.js"></script>
<script src="/assets/upload.bundle.js"></script>
<script src="/assets/editor.bundle.js"></script>
<script src="/assets/editor-integration.bundle.js"></script>
`;

const formatDate = (rawDate: unknown): string | null => {
    if (!rawDate) return null;
    if (rawDate instanceof Date) {
        return rawDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    } else if (typeof rawDate === 'string') {
        const parsed = new Date(rawDate);
        return isNaN(parsed.getTime()) ? rawDate : parsed.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    }
    return String(rawDate);
};

const renderMetadata = (frontmatter: Record<string, unknown>) => {
    const date = formatDate(frontmatter.date);
    const updated = formatDate(frontmatter.updated || frontmatter.modified);
    const author = frontmatter.author as string | undefined;
    const category = frontmatter.category as string | undefined;
    const tags = frontmatter.tags as string[] | string | undefined;
    const description = (frontmatter.description || frontmatter.summary) as string | undefined;
    const readingTime = frontmatter['reading-time'] as string | undefined;
    const image = (frontmatter.image || frontmatter.thumbnail) as string | undefined;
    const isDraft = frontmatter.draft === true;

    const hasAnyMeta = date || author || updated || category || tags || description || readingTime || isDraft;
    if (!hasAnyMeta && !image) return '';

    let html = '';

    // Featured image
    if (image) {
        html += `<img class="featured-image" src="${image}" alt="Featured image">`;
    }

    // Draft indicator
    if (isDraft) {
        html += `<div class="draft-badge">📝 Draft</div>`;
    }

    // Primary meta line (date, author, category, reading time)
    const metaParts = [];
    if (date) metaParts.push(`<span class="meta-date">${date}</span>`);
    if (updated && updated !== date) metaParts.push(`<span class="meta-updated">Updated ${updated}</span>`);
    if (author) metaParts.push(`<span class="meta-author">by ${author}</span>`);
    if (category) metaParts.push(`<span class="meta-category">${category}</span>`);
    if (readingTime) metaParts.push(`<span class="meta-reading-time">📖 ${readingTime}</span>`);

    if (metaParts.length > 0) {
        html += `<div class="article-meta">${metaParts.join(' · ')}</div>`;
    }

    // Tags as pills
    if (tags) {
        const tagList = Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim());
        const tagHtml = tagList.map(t => `<span class="tag">${t}</span>`).join('');
        html += `<div class="article-tags">${tagHtml}</div>`;
    }

    // Description/summary
    if (description) {
        html += `<p class="article-description">${description}</p>`;
    }

    return html;
};

const renderHtml = (content: string, title: string, config: GlintConfig, fileTree: FileNode[], currentPath: string, enableNumbering: boolean, headings: HeadingNode[] = [], frontmatter: Record<string, unknown> = {}) => `
<!DOCTYPE html>
<html lang="en">
${renderHead(title, config.theme)}
<body class="${config.theme} ${enableNumbering ? 'eqn-numbers' : ''}">
    ${renderSidebar(fileTree, currentPath, headings, config.theme)}
    <main class="content">
        <div class="content-wrapper">
            <header class="article-header">
                <h1>${title}</h1>
                ${renderMetadata(frontmatter)}
                <div class="title-accent"></div>
            </header>
            ${content}
        </div>
    </main>
    ${renderScripts()}
</body>
</html>
`;

async function resolveSafePath(contentDir: string, urlPath: string, config: GlintConfig) {
    let safePath = path.resolve(contentDir, urlPath.replace(/^\/+/, ''));
    if (!safePath.startsWith(contentDir)) {
        throw { code: 'FORBIDDEN', message: 'Forbidden' };
    }

    let stats;
    try {
        stats = await fs.stat(safePath);
    } catch (err) {
        // Path doesn't exist, try with .md extension
        if (!safePath.endsWith('.md')) {
            const mdPath = safePath + '.md';
            try {
                stats = await fs.stat(mdPath);
                safePath = mdPath;
            } catch {
                // Also doesn't exist - if we're resolving for save, we might want to return the .md path anyway?
                // For now, let's just return the original safePath + .md if it doesn't exist and we're not a dir
                safePath = mdPath;
            }
        }
    }

    if (stats?.isDirectory()) {
        safePath = path.join(safePath, config.baseFile);
        try {
            stats = await fs.stat(safePath);
        } catch {
            // Base file doesn't exist either
        }
    }

    // Final check for root
    if (safePath === contentDir) {
        safePath = path.join(contentDir, config.baseFile);
    }

    return { safePath, stats };
}

export async function createServer(contentDir: string) {
    let config = await loadConfig(contentDir);
    const assetsDir = path.join(import.meta.dirname, '..', 'assets');
    let processor = createProcessor(config);

    const fastify = Fastify({ logger: true });

    // Track active SSE clients for hot reloading
    const clients = new Set<any>();
    const broadcast = (data: string) => {
        for (const client of clients) {
            client.raw.write(`data: ${data}\n\n`);
        }
    };

    // LRU cache for rendered HTML
    const cache = new LRUCache<string, CacheEntry>({ max: 100 });

    // Unified Watcher
    const watchAll = async () => {
        try {
            const fs = await import('fs');
            fs.watch(contentDir, { recursive: true }, async (event, filename) => {
                if (!filename) return;

                if (filename === 'glint.json') {
                    try {
                        fastify.log.info('glint.json changed, reloading config...');
                        await new Promise(resolve => setTimeout(resolve, 200)); // Wait for write
                        config = await loadConfig(contentDir);
                        processor = createProcessor(config);
                        cache.clear();
                        broadcast('reload');
                        fastify.log.info('Config reloaded successfully');
                    } catch (err) {
                        fastify.log.error(err as any, 'Failed to reload config');
                    }
                } else if (filename.endsWith('.md')) {
                    cache.clear();
                    broadcast('reload');
                    fastify.log.info(`Content changed (${filename}), broadcasting reload`);
                }
            });
        } catch (err) {
            fastify.log.error(err as any, 'Failed to initialize watcher');
        }
    };
    watchAll();

    // SSE Endpoint for Hot Reloading
    fastify.get('/events', (request, reply) => {
        reply.raw.setHeader('Content-Type', 'text/event-stream');
        reply.raw.setHeader('Cache-Control', 'no-cache');
        reply.raw.setHeader('Connection', 'keep-alive');
        reply.raw.write('\n');

        clients.add(reply);

        request.raw.on('close', () => {
            clients.delete(reply);
        });
    });

    // Theme Update Endpoint
    fastify.post('/api/theme', async (request, reply) => {
        try {
            const { theme } = request.body as { theme: string };
            const themes = ['default', 'everforest-dark', 'nord', 'gruvbox-dark', 'catppuccin-mocha', 'solarized-light'];

            if (themes.includes(theme)) {
                const configPath = path.join(contentDir, 'glint.json');
                const currentConfig = await loadConfig(contentDir);
                const newConfig = { ...currentConfig, theme };

                await fs.writeFile(configPath, JSON.stringify(newConfig, null, 4));
                return { success: true };
            }
            return reply.code(400).send({ error: 'Invalid theme' });
        } catch (err) {
            fastify.log.error(err);
            return reply.code(500).send({ error: 'Failed to update theme' });
        }
    });

    // Register multipart support
    await fastify.register(fastifyMultipart);

    // [API] Save Content
    fastify.post('/api/save', async (request, reply) => {
        try {
            const body = request.body as { path: string; content: string; hash?: string };
            if (typeof body.path !== 'string' || typeof body.content !== 'string') {
                return reply.code(400).send({ error: 'Missing path or content' });
            }

            const { safePath } = await resolveSafePath(contentDir, body.path, config);

            // Optional: Optimistic locking could go here using body.hash

            await fs.writeFile(safePath, body.content, 'utf-8');
            const newHash = crypto.createHash('md5').update(body.content).digest('hex');

            return { success: true, hash: newHash };
        } catch (err: any) {
            if (err.code === 'FORBIDDEN') return reply.code(403).send({ error: err.message });
            fastify.log.error(err);
            return reply.code(500).send({ error: 'Failed to save file' });
        }
    });

    // [API] Get Source
    fastify.get('/api/source/*', async (request, reply) => {
        const urlPath = (request.params as { '*': string })['*'] || '';
        try {
            const { safePath } = await resolveSafePath(contentDir, urlPath, config);
            const content = await fs.readFile(safePath, 'utf-8');
            const hash = crypto.createHash('md5').update(content).digest('hex');
            return { content, hash, path: urlPath };
        } catch (err: any) {
            if (err.code === 'FORBIDDEN') return reply.code(403).send({ error: err.message });
            if (err.code === 'ENOENT') {
                return reply.code(404).send({ error: 'Not Found' });
            }
            fastify.log.error(err);
            return reply.code(500).send({ error: 'Internal Server Error' });
        }
    });

    // [API] Upload Image
    fastify.post('/api/upload', async (request, reply) => {
        try {
            const parts = request.parts();
            let fileBuffer: Buffer | undefined;
            let filename: string | undefined;
            let articlePath: string | undefined;

            for await (const part of parts) {
                if (part.type === 'file') {
                    // Consume stream immediately
                    fileBuffer = await part.toBuffer();
                    filename = part.filename;
                } else if (part.fieldname === 'articlePath') {
                    articlePath = (part as any).value as string;
                }
            }

            // Fallback for articlePath via query
            if (!articlePath) {
                articlePath = (request.query as any).articlePath;
            }

            if (!fileBuffer || !articlePath || !filename) {
                return reply.code(400).send({ error: 'Missing file or articlePath' });
            }

            const { safePath: resolvedArticlePath } = await resolveSafePath(contentDir, articlePath, config);

            const assetsDirName = path.basename(resolvedArticlePath) + '.assets';
            const assetsDir = path.join(path.dirname(resolvedArticlePath), assetsDirName);

            // Create assets directory if not exists
            await fs.mkdir(assetsDir, { recursive: true });

            const ext = path.extname(filename) || '.png';
            const timestamp = Date.now();
            const random = Math.random().toString(36).substring(7);
            const newFilename = `${timestamp}-${random}${ext}`;
            const destPath = path.join(assetsDir, newFilename);

            await fs.writeFile(destPath, fileBuffer);

            // Construct relative URL
            const relativeAssetsDir = path.relative(contentDir, assetsDir);
            const url = path.join('/content', relativeAssetsDir, newFilename);

            return { url };

        } catch (err: any) {
            if (err.code === 'FORBIDDEN') return reply.code(403).send({ error: err.message });
            fastify.log.error(err);
            return reply.code(500).send({ error: 'Upload failed' });
        }
    });

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
                const indexPath = path.join(fullPath, config.baseFile);
                try {
                    const indexStats = await fs.stat(indexPath);
                    fullPath = indexPath;
                    stats = indexStats;
                } catch (err) {
                    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
                        // Index file not found, render directory view with empty content
                        const html = renderHtml(
                            '<div class="empty-state">Select a file from the sidebar to view its content.</div>',
                            'Glint',
                            config,
                            fileTree,
                            urlPath,
                            false,
                            [],
                            {}
                        );
                        return reply.type('text/html').send(html);
                    }
                    throw err;
                }
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


            const preprocessResult = preprocessGlintMath(mdContent);
            const vfile = new VFile({
                value: preprocessResult.content,
                data: {
                    contentStartLine: configData.contentStartLine,
                    lineMapping: preprocessResult.lineMapping
                }
            });
            const result = await processor.process(vfile);
            const title = extractedTitle || path.basename(fullPath, '.md');
            const headings = result.data.headings || [];

            // Equation numbering logic
            const enableNumbering = (frontmatter as any)['eqn-numbers'] === true;

            const html = renderHtml(result.toString(), title, config, fileTree, urlPath, enableNumbering, headings, frontmatter);

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

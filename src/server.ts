import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs/promises';
import { LRUCache } from 'lru-cache';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeHighlight from 'rehype-highlight';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeStringify from 'rehype-stringify';
import rehypeRaw from 'rehype-raw';

import { loadConfig, type GlintConfig } from './config.js';
import { buildFileTree, type FileNode } from './filetree.js';
import { parseMarkdown } from './markdown.js';
import rehypeKatex from 'rehype-katex';
import { rehypeExtractHeadings, type HeadingNode } from './rehype-extract-headings.js';
import { remarkMermaidGlint } from './remark-mermaid-glint.js';
import { remarkWikiLinkGlint } from './remark-wiki-link-glint.js';
import { remarkGlintWidgets } from './remark-glint-widgets.js';
import { rehypeSourceLines } from './rehype-source-lines.js';
import { rehypeGlintImage } from './rehype-glint-image.js';
import { VFile } from 'vfile';
import * as renderer from './renderer.js';
import { resolveContentPath } from './utils/fs-utils.js';

import { setupSSERoutes } from './server/sse.js';
import { setupAPIRoutes } from './server/routes/api.js';

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
        .use(remarkMath)  // Protect $...$ and $$...$$ from markdown parsing
        .use(remarkGfm)
        .use(remarkGlintWidgets)
        .use(remarkWikiLinkGlint)
        .use(remarkMermaidGlint)
        .use(remarkRehype, { allowDangerousHtml: true })
        .use(rehypeSourceLines)
        .use(rehypeRaw)
        .use(rehypeGlintImage)
        .use(rehypeKatex, { macros, throwOnError: false, trust: true, strict: false })
        .use(rehypeHighlight, { detect: true })
        .use(rehypeSlug)
        .use(rehypeAutolinkHeadings, { behavior: 'wrap' })
        .use(rehypeExtractHeadings)
        .use(rehypeStringify, { allowDangerousHtml: true });
}

export async function createServer(contentDir: string) {
    let config = await loadConfig(contentDir);
    const assetsDir = path.join(import.meta.dirname, '..', 'assets');
    let processor = createProcessor(config);

    const fastify = Fastify({ logger: true });

    // Setup SSE
    const { broadcast } = setupSSERoutes(fastify);

    // Setup API Routes
    await setupAPIRoutes(fastify, contentDir);

    // LRU cache for rendered HTML
    const cache = new LRUCache<string, CacheEntry>({ max: 100 });

    // Title cache for sidebar
    const titleCache = new Map<string, string>();

    const updateTitleCache = async (relativePath: string) => {
        try {
            const { safePath } = await resolveContentPath(contentDir, relativePath, config, false);
            const raw = await fs.readFile(safePath, 'utf-8');
            const { title } = parseMarkdown(raw);
            if (title) {
                titleCache.set(relativePath, title);
            } else {
                titleCache.delete(relativePath);
            }
        } catch (err) {
            titleCache.delete(relativePath);
        }
    };

    // Unified Watcher
    const watchAll = async () => {
        try {
            const fsSync = await import('node:fs');
            fsSync.watch(contentDir, { recursive: true }, async (event, filename) => {
                if (!filename) return;

                if (filename.endsWith('.md')) {
                    await updateTitleCache(filename);
                    cache.clear();
                    broadcast('reload');
                }

                // Re-build file tree on any FS change
                fileTree = await buildFileTree(contentDir, '', titleCache);

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
                }
            });
        } catch (err) {
            fastify.log.error(err as any, 'Failed to initialize watcher');
        }
    };
    watchAll();

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
    const initialTree = await buildFileTree(contentDir);
    const scanTitles = async (nodes: FileNode[]) => {
        for (const node of nodes) {
            if (node.isDir) {
                await scanTitles(node.children || []);
            } else {
                await updateTitleCache(node.path + '.md');
            }
        }
    };
    await scanTitles(initialTree);
    let fileTree = await buildFileTree(contentDir, '', titleCache);

    fastify.get('/*', async (request, reply) => {
        const urlPath = (request.params as { '*': string })['*'] || '';

        try {
            // Note: We use resolveContentPath just to get the safe path and type,
            // but we don't rely on its isMarkdown check for rendering logic 
            // because we handle static files and markdown separately.
            const { safePath, stats, isMarkdown } = await resolveContentPath(contentDir, urlPath, config, false);

            if (!isMarkdown && stats) {
                const ext = path.extname(safePath).toLowerCase();
                if (IMAGE_EXTENSIONS.includes(ext)) {
                    const imageBuffer = await fs.readFile(safePath);
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
                }
                return reply.code(404).send('Not Found');
            }

            if (!isMarkdown) {
                return reply.code(404).send('Not Found');
            }

            // Check cache
            const cacheKey = safePath;
            if (cache.has(cacheKey)) {
                const entry = cache.get(cacheKey)!;
                if (entry.mtime >= stats!.mtimeMs) {
                    return reply.type('text/html').send(entry.html);
                }
            }

            // Read and Process
            const rawContent = await fs.readFile(safePath, 'utf-8');

            // Parse markdown (handles frontmatter and H1 stripping)
            const { content: cleanContent, title: frontmatterTitle, frontmatter, contentStartLine } = parseMarkdown(rawContent);

            // Run Unified Pipeline
            const file = new VFile({ value: cleanContent });
            file.data.contentStartLine = contentStartLine;

            const vfile = await processor.process(file);
            let htmlContent = String(vfile);

            // Combine into full HTML
            const pageTitle = frontmatterTitle || path.basename(urlPath, '.md').replace(/-/g, ' ');

            // Get headings from plugin
            const headings = (vfile.data.headings as HeadingNode[]) || [];

            const fullHtml = renderer.renderHtml(
                htmlContent,
                pageTitle,
                config,
                fileTree,
                urlPath,
                headings,
                frontmatter
            );

            // Cache it
            cache.set(cacheKey, { html: fullHtml, mtime: stats!.mtimeMs });

            return reply.type('text/html').send(fullHtml);

        } catch (err: any) {
            if (err.message === 'FORBIDDEN') return reply.code(403).send('Forbidden');
            if (err.code === 'ENOENT' || err.message === 'NOT_FOUND') return reply.code(404).send('Not Found');

            fastify.log.error(err);
            return reply.code(500).send('Internal Server Error');
        }
    });

    return { fastify, config };
}

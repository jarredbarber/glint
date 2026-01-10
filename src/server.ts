import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import path from 'node:path';
import fs from 'node:fs/promises';
import { LRUCache } from 'lru-cache';
import crypto from 'node:crypto';

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
import { buildFileTree, type FileNode } from './filetree.js';
import { parseMarkdown } from './markdown.js';
import { preprocessGlintMath } from './remark-glint-math.js';
import { rehypeExtractHeadings, type HeadingNode } from './rehype-extract-headings.js';
import { remarkMermaidGlint } from './remark-mermaid-glint.js';
import { remarkWikiLinkGlint } from './remark-wiki-link-glint.js';
import { remarkSlashCheckbox } from './remark-slash-checkbox.js';
import { rehypeSourceLines } from './rehype-source-lines.js';
import { rehypeGlintImage } from './rehype-glint-image.js';
import { VFile } from 'vfile';
import * as renderer from './renderer.js';
import { resolveContentPath } from './utils/fs-utils.js';

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
        .use(rehypeGlintImage)
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

            const { safePath } = await resolveContentPath(contentDir, body.path, config);

            // Optimistic locking
            if (body.hash) {
                try {
                    const existingContent = await fs.readFile(safePath, 'utf-8');
                    const existingHash = crypto.createHash('md5').update(existingContent).digest('hex');
                    if (existingHash !== body.hash) {
                        return reply.code(409).send({
                            error: 'Conflict: The file has been modified by someone else.',
                            conflict: true
                        });
                    }
                } catch (err) {
                    // If file doesn't exist, hash check is skipped (creating new file)
                }
            }

            await fs.writeFile(safePath, body.content, 'utf-8');
            const newHash = crypto.createHash('md5').update(body.content).digest('hex');

            return { success: true, hash: newHash };
        } catch (err: any) {
            if (err.message === 'FORBIDDEN') return reply.code(403).send({ error: 'Forbidden' });
            fastify.log.error(err);
            return reply.code(500).send({ error: 'Failed to save file' });
        }
    });

    // [API] Get Source
    fastify.get('/api/source/*', async (request, reply) => {
        const urlPath = (request.params as { '*': string })['*'] || '';
        try {
            const { safePath } = await resolveContentPath(contentDir, urlPath, config, false);
            const content = await fs.readFile(safePath, 'utf-8');
            const hash = crypto.createHash('md5').update(content).digest('hex');
            return { content, hash, path: urlPath };
        } catch (err: any) {
            if (err.message === 'FORBIDDEN') return reply.code(403).send({ error: 'Forbidden' });
            if (err.code === 'ENOENT' || err.message === 'NOT_FOUND') {
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

            // Unify: resolver handles the complexities
            const { safePath: resolvedArticlePath } = await resolveContentPath(contentDir, articlePath, config);

            const assetsDirName = path.basename(resolvedArticlePath) + '.assets';
            const assetsDir = path.join(path.dirname(resolvedArticlePath), assetsDirName);

            // Create assets directory if not exists
            await fs.mkdir(assetsDir, { recursive: true });

            const ext = path.extname(filename) || '.png';
            const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex').substring(0, 8);
            const newFilename = `${hash}${ext}`;
            const destPath = path.join(assetsDir, newFilename);

            await fs.writeFile(destPath, fileBuffer);

            // Construct relative URL
            const relativeAssetsDir = path.relative(contentDir, assetsDir);
            const url = path.join('/content', relativeAssetsDir, newFilename);

            return { url };

        } catch (err: any) {
            if (err.message === 'FORBIDDEN') return reply.code(403).send({ error: 'Forbidden' });
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
    // Initial title scan (could be optimized, but ok for now)
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
            const { safePath, stats, isMarkdown } = await resolveContentPath(contentDir, urlPath, config, false);

            // Handle non-markdown files (images, etc.) if they reached here
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
                // For other files, maybe redirect or 404
                return reply.code(404).send('Not Found');
            }

            // If we're here, it's a directory (handled by resolveContentPath mapping to baseFile) 
            // or a markdown file.

            // Check if resolveContentPath found the base file
            if (!stats || !isMarkdown) {
                // Directory found but index file missing -> Empty State
                const html = renderer.renderHtml(
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

            const mtime = stats.mtimeMs;
            const cached = cache.get(safePath);

            // Return cached version if mtime hasn't changed
            if (cached && cached.mtime === mtime) {
                return reply.type('text/html').send(cached.html);
            }

            const rawContent = await fs.readFile(safePath, 'utf-8');
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
            const title = extractedTitle || path.basename(safePath, '.md');
            const headings = result.data.headings || [];

            // Equation numbering logic
            const enableNumbering = (frontmatter as any)['eqn-numbers'] === true;

            const html = renderer.renderHtml(result.toString(), title, config, fileTree, urlPath, enableNumbering, headings, frontmatter);

            // Cache the result
            cache.set(safePath, { html, mtime });

            reply.type('text/html').send(html);
        } catch (err: any) {
            if (err.message === 'FORBIDDEN') return reply.code(403).send('Forbidden');
            if (err.message === 'NOT_FOUND' || err.code === 'ENOENT') {
                reply.code(404).send('Not Found');
            } else {
                fastify.log.error(err);
                reply.code(500).send('Internal Server Error');
            }
        }
    });

    return { fastify, config };
}

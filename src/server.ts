import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import formbody from '@fastify/formbody';
import path from 'node:path';
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

import { loadConfig, type GlintConfig, getProcessedMacros } from './config.js';
import { buildFileTree, type FileNode } from './filetree.js';
import { parseMarkdown } from './markdown.js';
import rehypeKatex from 'rehype-katex';
import { rehypeExtractHeadings, type HeadingNode } from './rehype-extract-headings.js';
import { remarkMermaidGlint } from './remark-mermaid-glint.js';
import { remarkWikiLinkGlint } from './remark-wiki-link-glint.js';
import { remarkGlintWidgets } from './remark-glint-widgets.js';
import { widgets } from './widgets/index.js';
import { rehypeSourceLines } from './rehype-source-lines.js';
import { rehypeGlintSections } from './rehype-glint-sections.js';
import { rehypeGlintImage } from './rehype-glint-image.js';
import { rehypeGlintCodeBlocks } from './rehype-glint-code-blocks.js';
import { remarkGlintCitations } from './remark-glint-citations.js';
import { rehypeGlintCitations } from './rehype-glint-citations.js';
import { VFile } from 'vfile';
import * as renderer from './renderer.js';
import { isForbiddenError, isNotFoundError, NotFoundError } from './utils/errors.js';

import { setupSSERoutes } from './server/sse.js';
import { setupAPIRoutes } from './server/routes/api.js';
import { setupAuthRoutes } from './server/routes/auth.js';
import { setupGitRoutes } from './server/routes/git.js';
import { setupAuth } from './server/auth.js';
import { ShareService } from './server/share.js';
import { TaskScanner } from './tasks/scanner.js';
import { StorageManager } from './storage/index.js';
import { resolveStoragePath } from './storage/utils.js';
import { setupTaskRoutes } from './server/routes/tasks.js';
import { JournalScanner } from './journal/scanner.js';
import { setupJournalRoutes } from './server/routes/journal.js';
import { setupDocumentRoutes } from './server/routes/documents.js';




export function createProcessor(config: GlintConfig, linkValidator: (path: string) => boolean) {
    const macros = getProcessedMacros(config);

    return unified()
        .use(remarkParse)
        .use(remarkMath)  // Protect $...$ and $$...$$ from markdown parsing
        .use(remarkGfm)
        .use(remarkGlintWidgets)
        .use(remarkGlintCitations)
        .use(remarkWikiLinkGlint, { validateLink: linkValidator })
        .use(remarkMermaidGlint)
        .use(remarkRehype, { allowDangerousHtml: true })
        .use(rehypeSourceLines)
        .use(rehypeGlintSections)
        .use(rehypeRaw)
        .use(rehypeGlintImage)
        .use(rehypeGlintCitations)
        .use(rehypeKatex, { macros, throwOnError: false, trust: true, strict: false })
        .use(rehypeHighlight, { detect: true })
        .use(rehypeGlintCodeBlocks)
        .use(rehypeSlug)
        .use(rehypeExtractHeadings)
        .use(rehypeAutolinkHeadings, {
            behavior: 'prepend',
            properties: { className: ['heading-anchor'] },
            content: { type: 'text', value: '#' }
        })
        .use(rehypeStringify, { allowDangerousHtml: true });
}

export async function createServer(contentDir: string, configPath?: string) {
    let config = await loadConfig(contentDir, configPath);
    const assetsDir = path.join(import.meta.dirname, '..', 'assets');

    // State
    const titleCache = new Map<string, string>();
    const knownPaths = new Set<string>();
    let fileTree: FileNode[] = [];

    let processor = createProcessor(config, (p) => knownPaths.has(p));

    const fastify = Fastify({ logger: true });

    // Config getter for dynamic access
    const getConfig = () => config;

    // Parse form submissions (needed for login form)
    await fastify.register(formbody);


    // Initialize Storage Manager
    const storageManager = new StorageManager(config, contentDir);

    // Initialize Share Service
    const shareService = new ShareService(storageManager);
    await shareService.load();

    // Setup Auth (must be before routes)
    await setupAuth(fastify, getConfig, shareService);

    // Setup SSE
    const { broadcast } = setupSSERoutes(fastify);

    // Forward storage errors to client
    storageManager.onError((error) => {
        fastify.log.error(error, 'Storage background error');
        broadcast(JSON.stringify({ message: error.message }), 'glint:error');
    });

    // Setup Auth Routes
    await setupAuthRoutes(fastify, getConfig);

    // Initialize Task Scanner
    const taskScanner = new TaskScanner(storageManager);
    const journalScanner = new JournalScanner(storageManager);
    await taskScanner.scanAll(); // Initial scan

    // Setup API Routes
    await setupAPIRoutes(fastify, contentDir, getConfig, shareService, taskScanner, storageManager);

    // Setup Task Routes
    await setupTaskRoutes(fastify, getConfig, taskScanner, storageManager);
    await setupJournalRoutes(fastify, getConfig, journalScanner, storageManager, processor);

    // Setup Document Routes
    await setupDocumentRoutes(fastify, storageManager, getConfig, processor);



    // Setup Git Routes
    await setupGitRoutes(fastify, contentDir, getConfig, storageManager);

    const updateKnownPaths = (nodes: FileNode[]) => {
        for (const node of nodes) {
            if (node.isDir) {
                updateKnownPaths(node.children || []);
            } else {
                knownPaths.add(node.path + '.md');
            }
        }
    };

    const updateTitleCache = async (relativePath: string) => {
        try {
            const content = await storageManager.read(relativePath);
            const { title } = parseMarkdown(content);
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
    let fileTreeRebuildTimer: ReturnType<typeof setTimeout> | null = null;
    const watchAll = () => {
        try {
            storageManager.watch('', async (event, filename) => {
                if (!filename) return;

                if (filename.endsWith('.md')) {
                    await updateTitleCache(filename);
                    storageManager.invalidateCache(filename);
                    broadcast('reload');
                }

                // Debounce file tree rebuild to prevent race conditions during rapid changes (e.g., git operations)
                if (fileTreeRebuildTimer) {
                    clearTimeout(fileTreeRebuildTimer);
                }
                fileTreeRebuildTimer = setTimeout(async () => {
                    try {
                        fileTree = await buildFileTree(storageManager, '', titleCache);
                        knownPaths.clear();
                        updateKnownPaths(fileTree);
                    } catch (err) {
                        fastify.log.error(err as any, 'Failed to rebuild file tree');
                    }
                }, 300);

                const isConfig = filename === 'glint.json' || filename === 'glint.toml' ||
                    filename === '.glint/config.json' || filename === '.glint/config.toml' ||
                    filename === path.join('.glint', 'config.json') || filename === path.join('.glint', 'config.toml');

                if (isConfig) {
                    try {
                        fastify.log.info(`${filename} changed, reloading config...`);
                        await new Promise(resolve => setTimeout(resolve, 200)); // Wait for write
                        config = await loadConfig(contentDir, configPath);
                        processor = createProcessor(config, (p) => knownPaths.has(p));
                        storageManager.clearCache();
                        taskScanner.invalidate(filename);
                        journalScanner.invalidate(filename);
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

    // UI-related setup: only when not in headless mode
    if (!config.headless) {
        // Serve bundled assets
        fastify.register(fastifyStatic, {
            root: assetsDir,
            prefix: '/assets/',
            decorateReply: false,
        });

        // Serve images from content directory
        // Build file tree once at startup
        const initialTree = await buildFileTree(storageManager);
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
        fileTree = await buildFileTree(storageManager, '', titleCache);
        updateKnownPaths(fileTree);

        // Share Route
        fastify.get('/s/:shareId', async (request, reply) => {
            const { shareId } = request.params as { shareId: string };
            const share = shareService.getShare(shareId);

            if (!share) {
                return reply.code(404).send('Share link not found or expired');
            }

            try {
                // Check existence and get stats
                let stat;
                let resolvedPath = share.filePath;

                try {
                    const resolved = await resolveStoragePath(storageManager, share.filePath, config);
                    stat = resolved.stat;
                    resolvedPath = resolved.path;

                    if (!resolved.isMarkdown || stat.isDirectory) {
                        return reply.code(404).send('Linked file not found');
                    }

                } catch {
                    return reply.code(404).send('Linked file not found');
                }

                // Check if share is already cached
                const cacheKey = `share:${shareId}:${resolvedPath}`;
                const cached = storageManager.getCachedHtml(cacheKey);
                if (cached && cached.mtime >= stat.mtime.getTime()) {
                    return reply.type('text/html').send(cached.html);
                }

                // Read and Process
                const rawContent = await storageManager.read(resolvedPath);
                const { content: cleanContent, title: frontmatterTitle, frontmatter, contentStartLine } = parseMarkdown(rawContent);

                // Run Unified Pipeline
                const file = new VFile({ value: cleanContent });
                file.data.contentStartLine = contentStartLine;
                file.data.filePath = resolvedPath;
                file.data.shareId = shareId;

                const vfile = await processor.process(file);
                let htmlContent = String(vfile);

                const pageTitle = frontmatterTitle || path.basename(resolvedPath, '.md').replace(/-/g, ' ');
                const headings = (vfile.data.headings as HeadingNode[]) || [];

                const fullHtml = renderer.renderHtml({
                    content: htmlContent,
                    title: pageTitle,
                    config,
                    fileTree,
                    currentPath: resolvedPath,
                    headings,
                    frontmatter,
                    authEnabled: config.auth?.enabled ?? false,
                    authenticated: request.isAuthenticated(),
                    access: share.access,
                    shareId: shareId
                });

                storageManager.setCachedHtml(cacheKey, { html: fullHtml, mtime: stat.mtime.getTime() });
                return reply.type('text/html').send(fullHtml);

            } catch (err) {
                if (isForbiddenError(err)) return reply.code(403).send('Forbidden');
                if (isNotFoundError(err)) return reply.code(404).send('Not Found');
                fastify.log.error(err as Error);
                return reply.code(500).send('Internal Server Error');
            }
        });

        // LLM.txt - Machine-readable documentation for AI agents
        fastify.get('/llm.txt', async (request, reply) => {
            const widgetInstructions = widgets
                .filter(w => w.getLLMInstructions)
                .map(w => w.getLLMInstructions!())
                .join('\n');

            const llmTxt = `# Glint Markdown Documentation

This document describes the Glint-flavored markdown syntax for AI agents.

## Standard Markdown
Glint supports GitHub Flavored Markdown (GFM) including:
- Headers, paragraphs, lists, blockquotes
- Bold, italic, strikethrough, code spans
- Fenced code blocks with syntax highlighting
- Tables, footnotes, autolinks

## Glint Extensions

### Wiki Links
- Syntax: \`[[Page Name]]\` or \`[[Page Name|Display Text]]\`
- Links to internal pages (spaces become URL-encoded)
- Broken links are styled differently

### Math (LaTeX)
- Inline: \`$equation$\`
- Block: \`$$equation$$\`
- Uses KaTeX for rendering

### Mermaid Diagrams
\`\`\`mermaid
graph TD
    A --> B
\`\`\`

### Citations
- Define in ## References section: \`[ref:id] "Title" Author (Year) URL\`
- Cite inline: \`[[#ref:id]]\`
- Auto-numbered in order of appearance

${widgetInstructions}

## API Endpoints

### Reading Documents
- GET /api/documents/:path - Get document content and metadata
- GET /api/documents/:path/raw - Get raw markdown

### Writing Documents
- PUT /api/documents/:path - Update document content
- POST /api/documents/batch - Batch update multiple documents

### Tasks
- GET /api/tasks - List all tasks across documents
- PUT /api/tasks/:id - Update task state

### Rendering
- POST /api/render - Render markdown to HTML
`;

            reply.type('text/plain; charset=utf-8').send(llmTxt);
        });

        const handleDocument = async (targetPath: string, request: any, reply: any, currentUrl: string) => {
            // Check authentication
            const access = request.getAccess(targetPath);
            if (access === null) {
                return reply.redirect(`/api/auth/login?redirect=${encodeURIComponent(currentUrl)}`);
            }

            try {
                // Resolve path using StorageManager
                const { path: filePath, stat, isMarkdown } = await resolveStoragePath(storageManager, targetPath, config);

                if (!isMarkdown) {
                    return reply.code(404).send('Not Found');
                }

                // Check cache
                const cacheKey = filePath;
                const cached = storageManager.getCachedHtml(cacheKey);
                if (cached && cached.mtime >= stat.mtime.getTime()) {
                    return reply.type('text/html').send(cached.html);
                }

                // Read and Process
                const rawContent = await storageManager.read(filePath);
                const { content: cleanContent, title: frontmatterTitle, frontmatter, contentStartLine } = parseMarkdown(rawContent);

                // Run Unified Pipeline
                const file = new VFile({ value: cleanContent });
                file.data.contentStartLine = contentStartLine;
                file.data.filePath = filePath;

                const vfile = await processor.process(file);
                let htmlContent = String(vfile);

                // Combine into full HTML
                const pageTitle = frontmatterTitle || path.basename(filePath, '.md').replace(/-/g, ' ');

                const headings = (vfile.data.headings as HeadingNode[]) || [];

                const fullHtml = renderer.renderHtml({
                    content: htmlContent,
                    title: pageTitle,
                    config,
                    fileTree,
                    currentPath: filePath,
                    headings,
                    frontmatter,
                    authEnabled: config.auth?.enabled ?? false,
                    authenticated: request.isAuthenticated(),
                });

                // Cache it
                storageManager.setCachedHtml(cacheKey, { html: fullHtml, mtime: stat.mtime.getTime() });

                reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
                return reply.type('text/html').send(fullHtml);

            } catch (err: unknown) {
                if (isForbiddenError(err)) return reply.code(403).send('Forbidden');
                if (isNotFoundError(err)) return reply.code(404).send('Not Found');

                fastify.log.error(err as Error);
                return reply.code(500).send('Internal Server Error');
            }
        };

        // File Route
        fastify.get('/f/*', async (request, reply) => {
            const urlPath = (request.params as { '*': string })['*'] || '';
            return handleDocument(urlPath, request, reply, `/f/${urlPath}`);
        });

        // Redirect old dashboard route
        fastify.get('/dashboard', async (request, reply) => {
            return reply.redirect('/d/tasks');
        });

        fastify.get('/*', async (request, reply) => {
            const urlPath = (request.params as { '*': string })['*'] || '';

            // Skip auth check for login page or favicon
            if (urlPath === 'login' || urlPath === 'favicon.ico') {
                return reply.code(404).send('Not Found');
            }

            // Special handling for root path: Check if baseFile exists
            if (urlPath === '') {
                const baseExist = await storageManager.exists(config.baseFile);
                if (!baseExist) {
                    return reply.redirect('/d/tasks');
                }
            }

            // Legacy support: redirect to /f/ path if not a dashboard or special path
            // But for now, we just handle it here to keep existing links active as requested
            return handleDocument(urlPath, request, reply, `/${urlPath}`);
        });
    } // End of if (!config.headless)

    // Start git provider sync loops
    await storageManager.startGitSync();

    return { fastify, config, storageManager };
}

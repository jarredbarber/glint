// src/build.ts
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import chokidar from 'chokidar';
import { VFile } from 'vfile';
import { loadConfig } from './config.js';
import { StorageManager } from './storage/index.js';
import { buildFileTree, type FileNode } from './filetree.js';
import { parseMarkdown } from './markdown.js';
import { createProcessor } from './server.js';
import * as renderer from './renderer.js';
import { rewriteStaticHtml, applyPrefix } from './url-rewrite.js';
import type { HeadingNode } from './rehype-extract-headings.js';

export interface BuildOptions {
    contentDir: string;
    outDir: string;
    configPath?: string;
    /** Base-path prefix for hosting under a subpath, e.g. "/wiki". */
    prefix?: string;
}

export interface BuildResult {
    pages: number;
    failures: { path: string; error: string }[];
    assetsCopied: number;
}

/** Flatten the file tree into the list of markdown file paths (posix, .md). */
function collectMarkdownPaths(nodes: FileNode[], acc: string[] = []): string[] {
    for (const node of nodes) {
        if (node.isDir) {
            if (node.children) collectMarkdownPaths(node.children, acc);
        } else if (node.path.endsWith('.md')) {
            acc.push(node.path);
        }
    }
    return acc;
}

/** Map a content path like "foo/bar.md" to its output file "foo/bar/index.html". */
function outputHtmlPath(outDir: string, contentPath: string): string {
    const noExt = contentPath.replace(/\.md$/, '');
    return path.join(outDir, noExt, 'index.html');
}

async function writeFile(filePath: string, data: string | Buffer): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data);
}

/** Copy a directory recursively from storage-relative path into dist (mirrored). */
async function copyAssetDir(
    storage: StorageManager,
    relDir: string,
    outDir: string,
    onCopied: () => void
): Promise<void> {
    let entries;
    try {
        entries = await storage.list(relDir);
    } catch {
        return;
    }
    for (const entry of entries) {
        const childRel = `${relDir}/${entry.name}`;
        if (entry.type === 'directory') {
            await copyAssetDir(storage, childRel, outDir, onCopied);
        } else {
            const buf = await storage.readBuffer(childRel);
            await writeFile(path.join(outDir, childRel), buf);
            onCopied();
        }
    }
}

export async function buildSite(opts: BuildOptions): Promise<BuildResult> {
    const config = await loadConfig(opts.contentDir, opts.configPath);
    const storage = new StorageManager(config, opts.contentDir);

    const fileTree = await buildFileTree(storage);
    const mdPaths = collectMarkdownPaths(fileTree);
    const knownPaths = new Set(mdPaths);
    const processor = createProcessor(config, (p) => knownPaths.has(p));

    const result: BuildResult = { pages: 0, failures: [], assetsCopied: 0 };

    // Guard against destructive wipes of important directories.
    const resolvedOut = path.resolve(opts.outDir);
    const resolvedContent = path.resolve(opts.contentDir);
    const root = path.parse(resolvedOut).root;
    if (
        resolvedOut === root ||
        resolvedOut === os.homedir() ||
        resolvedOut === resolvedContent ||
        resolvedContent === resolvedOut ||
        (resolvedContent + path.sep).startsWith(resolvedOut + path.sep)
    ) {
        throw new Error(`Refusing to build into "${resolvedOut}": it is the filesystem root, your home directory, or contains the content directory. Choose a separate --out path.`);
    }

    // Clean output dir.
    await fs.rm(opts.outDir, { recursive: true, force: true });
    await fs.mkdir(opts.outDir, { recursive: true });

    for (const contentPath of mdPaths) {
        try {
            const raw = await storage.read(contentPath);
            const { content, title: fmTitle, frontmatter, contentStartLine } = parseMarkdown(raw);

            const file = new VFile({ value: content });
            file.data.contentStartLine = contentStartLine;
            file.data.filePath = contentPath;

            const vfile = await processor.process(file);
            const headings = (vfile.data.headings as HeadingNode[]) || [];
            const title = fmTitle || path.basename(contentPath, '.md').replace(/-/g, ' ');

            let html = renderer.renderHtml({
                content: String(vfile),
                title,
                config,
                fileTree,
                currentPath: contentPath,
                headings,
                frontmatter,
                static: true,
            });
            html = rewriteStaticHtml(html);
            if (opts.prefix) html = applyPrefix(html, opts.prefix);

            await writeFile(outputHtmlPath(opts.outDir, contentPath), html);
            result.pages++;

            if (contentPath === config.baseFile) {
                await writeFile(path.join(opts.outDir, 'index.html'), html);
            }

            // Copy this article's image assets, if any.
            const assetsRel = `${contentPath}.assets`;
            if (await storage.exists(assetsRel)) {
                await copyAssetDir(storage, assetsRel, opts.outDir, () => result.assetsCopied++);
            }
        } catch (err) {
            result.failures.push({ path: contentPath, error: (err as Error).message });
        }
    }

    // Copy bundled client assets (referenced as /assets/...).
    const repoAssets = path.join(import.meta.dirname, '..', 'assets');
    await fs.cp(repoAssets, path.join(opts.outDir, 'assets'), { recursive: true });

    return result;
}

/**
 * Build once, then watch the content dir and rebuild (debounced) on change.
 * The output dir is ignored so the build's own writes don't trigger a loop.
 * Returns a function that stops watching. Resolves after the initial build.
 */
export async function watchSite(
    opts: BuildOptions,
    log: (msg: string) => void = console.log
): Promise<() => Promise<void>> {
    const resolvedOut = path.resolve(opts.outDir);
    const resolvedContent = path.resolve(opts.contentDir);

    const run = async () => {
        try {
            const r = await buildSite(opts);
            log(`✓ rebuilt ${r.pages} pages, ${r.assetsCopied} asset files`);
            for (const f of r.failures) log(`  ✗ ${f.path}: ${f.error}`);
        } catch (err) {
            log(`✗ build error: ${(err as Error).message}`);
        }
    };

    // In-flight guard: only one build runs at a time. Changes that land while a
    // build is running set `pending`, which triggers exactly one trailing
    // rebuild after the current one finishes — so output always reflects the
    // latest state and concurrent builds never race on the output dir.
    let building = false;
    let pending = false;
    const trigger = async () => {
        if (building) { pending = true; return; }
        building = true;
        try {
            do {
                pending = false;
                await run();
            } while (pending);
        } finally {
            building = false;
        }
    };

    await trigger(); // initial build

    let timer: ReturnType<typeof setTimeout> | null = null;
    const watcher = chokidar.watch(resolvedContent, {
        ignoreInitial: true,
        persistent: true,
        ignored: (p: string) => {
            const abs = path.resolve(p);
            return (
                abs === resolvedOut ||
                (abs + path.sep).startsWith(resolvedOut + path.sep) ||
                /(^|[/\\])\./.test(p) ||
                p.includes('node_modules')
            );
        },
    });

    watcher.on('all', () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { void trigger(); }, 300);
    });

    log(`Watching ${resolvedContent} for changes (ignoring ${resolvedOut})...`);
    return async () => {
        if (timer) clearTimeout(timer);
        await watcher.close();
    };
}

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
import { rewriteStaticHtml, applyPrefix, applyKatexCdn, stripInternalLinks, rewriteShareAssets, relativizeShareAssets } from './url-rewrite.js';
import { shareSlug } from './share-slug.js';
import type { HeadingNode } from './rehype-extract-headings.js';

export interface BuildOptions {
    contentDir: string;
    outDir: string;
    configPath?: string;
    /** Base-path prefix for hosting under a subpath, e.g. "/wiki". */
    prefix?: string;
    /** Inline KaTeX fonts as data: URIs (for sandboxed/opaque-origin hosts). */
    inlineFonts?: boolean;
    /** Load KaTeX CSS/fonts from the jsDelivr CDN instead of self-hosting. */
    katexCdn?: boolean;
    /** Separate output dir for share pages. Defaults to `<outDir>/share`. */
    sharedOut?: string;
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

/**
 * Render and write a single standalone share page plus its image assets.
 * Mirrors the normal render transforms, then strips internal links and makes
 * the page's own assets relative so the emitted <share-root>/<slug>/ dir is
 * self-contained.
 */
async function emitSharePage(
    opts: BuildOptions,
    shareRoot: string,
    contentPath: string,
    renderArgs: Parameters<typeof renderer.renderHtml>[0],
    storage: StorageManager,
    katexVersion: string,
    onCopied: () => void
): Promise<void> {
    const slug = shareSlug(contentPath);

    let html = renderer.renderHtml({ ...renderArgs, static: true, standalone: true });
    html = rewriteStaticHtml(html);
    html = stripInternalLinks(html);
    html = rewriteShareAssets(html, contentPath);
    if (opts.katexCdn) html = applyKatexCdn(html, katexVersion);
    // Relativize chrome assets last so the page loads its CSS/JS from the share
    // root's own assets/ copy — self-contained wherever the share dir is hosted.
    // Run after applyKatexCdn (which may swap in an absolute CDN URL) and instead
    // of applyPrefix (a self-contained page needs no subpath prefix).
    html = relativizeShareAssets(html);

    await writeFile(path.join(shareRoot, slug, 'index.html'), html);

    const assetsRel = `${contentPath}.assets`;
    if (await storage.exists(assetsRel)) {
        const base = path.posix.basename(contentPath); // e.g. "first.md"
        await copyShareAssets(storage, assetsRel, path.join(shareRoot, slug, `${base}.assets`), onCopied);
    }
}

/** Copy a storage dir tree into an absolute destination dir. */
async function copyShareAssets(
    storage: StorageManager,
    relDir: string,
    destDir: string,
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
            await copyShareAssets(storage, childRel, path.join(destDir, entry.name), onCopied);
        } else {
            const buf = await storage.readBuffer(childRel);
            await writeFile(path.join(destDir, entry.name), buf);
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
    const katexVersion = opts.katexCdn ? await resolveKatexVersion() : '';
    let sharePagesEmitted = 0;

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

    const shareRoot = opts.sharedOut ? path.resolve(opts.sharedOut) : path.join(opts.outDir, 'share');
    const resolvedShareRoot = path.resolve(shareRoot);
    const shareRootIsSeparate =
        !!opts.sharedOut &&
        resolvedShareRoot !== resolvedOut &&
        !(resolvedShareRoot + path.sep).startsWith(resolvedOut + path.sep);

    if (shareRootIsSeparate) {
        const sroot = path.parse(resolvedShareRoot).root;
        const contains = (parent: string, child: string) =>
            child === parent || (child + path.sep).startsWith(parent + path.sep);
        if (
            resolvedShareRoot === sroot ||
            resolvedShareRoot === os.homedir() ||
            contains(resolvedShareRoot, resolvedContent) ||
            contains(resolvedShareRoot, resolvedOut)
        ) {
            throw new Error(`Refusing to use "${resolvedShareRoot}" as --shared-out: it is the filesystem root, your home directory, or a directory that contains the content or output directory.`);
        }
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
            if (opts.katexCdn) html = applyKatexCdn(html, katexVersion);
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

            if (frontmatter.share === true) {
                await emitSharePage(
                    opts,
                    shareRoot,
                    contentPath,
                    { content: String(vfile), title, config, fileTree, currentPath: contentPath, headings, frontmatter },
                    storage,
                    katexVersion,
                    () => result.assetsCopied++
                );
                sharePagesEmitted++;
            }
        } catch (err) {
            result.failures.push({ path: contentPath, error: (err as Error).message });
        }
    }

    // Copy bundled client assets (referenced as /assets/...).
    const repoAssets = path.join(import.meta.dirname, '..', 'assets');
    await fs.cp(repoAssets, path.join(opts.outDir, 'assets'), { recursive: true });

    // Optionally inline KaTeX fonts so math renders in sandboxed/opaque-origin
    // hosts where CORS-mode font fetches are blocked.
    if (opts.inlineFonts) {
        await inlineKatexFonts(path.join(opts.outDir, 'assets', 'katex'));
    }

    // Share pages reference their chrome via relative "../assets/…", so the share
    // root needs its own copy of the client assets (JS bundles + KaTeX). This
    // holds whether shareRoot is the default "<out>/share" or a separate
    // --shared-out dir — in both cases shareRoot/assets is distinct from
    // out/assets. Skipped when no page opted into sharing.
    if (sharePagesEmitted > 0) {
        await fs.cp(repoAssets, path.join(resolvedShareRoot, 'assets'), { recursive: true });
        if (opts.inlineFonts) {
            await inlineKatexFonts(path.join(resolvedShareRoot, 'assets', 'katex'));
        }
    }

    return result;
}

/**
 * Rewrites katex.min.css in place so each `url(fonts/KaTeX_*.woff2)` becomes an
 * inlined `url(data:font/woff2;base64,…)`. data: URLs are exempt from CORS, so
 * the fonts load even when the page has an opaque/null origin (sandboxed host).
 * woff2 is listed first in every @font-face src, so browsers use the data URI
 * and never request the .woff/.ttf fallbacks. No-op if the CSS isn't present.
 */
/** Resolve the installed KaTeX version so the CDN CSS matches the renderer. */
export async function resolveKatexVersion(): Promise<string> {
    try {
        const pkgPath = path.join(import.meta.dirname, '..', 'node_modules', 'katex', 'package.json');
        const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
        return pkg.version as string;
    } catch {
        return '0.16'; // jsDelivr resolves a bare major/minor to the latest patch
    }
}

async function inlineKatexFonts(katexDir: string): Promise<void> {
    const cssPath = path.join(katexDir, 'katex.min.css');
    let css: string;
    try {
        css = await fs.readFile(cssPath, 'utf8');
    } catch {
        return; // no katex css to process
    }

    const fontUrl = /url\(fonts\/(KaTeX_[\w-]+\.woff2)\)/g;
    const cache = new Map<string, string>();
    for (const [, fname] of css.matchAll(fontUrl)) {
        if (cache.has(fname)) continue;
        try {
            const buf = await fs.readFile(path.join(katexDir, 'fonts', fname));
            cache.set(fname, `url(data:font/woff2;base64,${buf.toString('base64')})`);
        } catch {
            cache.set(fname, `url(fonts/${fname})`); // leave as-is if missing
        }
    }

    css = css.replace(fontUrl, (_full, fname: string) => cache.get(fname) || _full);
    await fs.writeFile(cssPath, css);
}

/**
 * Build once, then watch the content dir and rebuild (debounced) on change.
 * The output dir is ignored so the build's own writes don't trigger a loop.
 * Returns a function that stops watching. Resolves after the initial build.
 */
export async function watchSite(
    opts: BuildOptions,
    log: (msg: string) => void = console.log,
    onRebuild?: () => void | Promise<void>
): Promise<() => Promise<void>> {
    const resolvedOut = path.resolve(opts.outDir);
    const resolvedContent = path.resolve(opts.contentDir);

    const run = async (): Promise<boolean> => {
        try {
            const r = await buildSite(opts);
            log(`✓ rebuilt ${r.pages} pages, ${r.assetsCopied} asset files`);
            for (const f of r.failures) log(`  ✗ ${f.path}: ${f.error}`);
            return true;
        } catch (err) {
            log(`✗ build error: ${(err as Error).message}`);
            return false;
        }
    };

    // In-flight guard: only one build runs at a time. Changes that land while a
    // build is running set `pending`, which triggers exactly one trailing
    // rebuild after the current one finishes — so output always reflects the
    // latest state and concurrent builds never race on the output dir. The
    // onRebuild hook (e.g. a deploy) runs once after a burst settles, while the
    // lock is still held, so it never reads a half-written output dir.
    let building = false;
    let pending = false;
    const trigger = async () => {
        if (building) { pending = true; return; }
        building = true;
        try {
            let ok = false;
            do {
                pending = false;
                ok = await run();
            } while (pending);
            if (ok && onRebuild) {
                try {
                    await onRebuild();
                } catch (err) {
                    log(`✗ post-hook error: ${(err as Error).message}`);
                }
            }
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

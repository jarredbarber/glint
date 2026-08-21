// src/render.ts
// Single-file renderer: renders one markdown file to a self-contained HTML
// document. Chrome CSS is inlined as <style>, images are inlined as data: URIs,
// all JavaScript is stripped, and KaTeX CSS/fonts load from the CDN. The result
// is one portable .html file with no sidecar assets (fonts excepted).
import path from 'node:path';
import fs from 'node:fs/promises';
import { VFile } from 'vfile';
import { loadConfig } from './config.js';
import { parseMarkdown } from './markdown.js';
import { createProcessor } from './server.js';
import * as renderer from './renderer.js';
import { rewriteStaticHtml, stripInternalLinks, applyKatexCdn } from './url-rewrite.js';
import type { HeadingNode } from './rehype-extract-headings.js';

/**
 * Resolve the installed KaTeX version for the CDN stylesheet URL. Falls back to
 * a bare major/minor (jsDelivr resolves that to the latest patch) when the
 * package can't be read.
 */
export async function resolveKatexVersion(): Promise<string> {
    try {
        const pkgPath = path.join(import.meta.dirname, '..', 'node_modules', 'katex', 'package.json');
        const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
        return pkg.version as string;
    } catch {
        return '0.16'; // jsDelivr resolves a bare major/minor to the latest patch
    }
}

/**
 * Removes every <script> element from the HTML — both inline blocks and
 * external `<script src>` tags. The single-file render is fully static, so no
 * client JS is emitted. Pure.
 *
 * With `keepMermaid`, mermaid-related scripts survive (the CDN loader and the
 * `mermaid.initialize` block) so client-rendered diagrams still draw — every
 * other script is still dropped. A script "is mermaid" if the tag or its body
 * mentions mermaid.
 */
export function stripScripts(html: string, opts: { keepMermaid?: boolean; keepAbcjs?: boolean } = {}): string {
    return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (tag) => {
        if (opts.keepMermaid && /mermaid/i.test(tag)) return tag;
        if (opts.keepAbcjs && /abcjs/i.test(tag)) return tag;
        return '';
    });
}

/**
 * Replaces each `<link rel="stylesheet" href="X">` whose href is a key in
 * `cssByHref` with an inline `<style>…</style>` block holding that CSS. Links
 * not in the map (e.g. an external CDN stylesheet) are left untouched, so the
 * KaTeX CDN <link> survives. Pure.
 */
export function inlineStylesheets(html: string, cssByHref: Map<string, string>): string {
    return html.replace(
        /<link\b[^>]*\brel="stylesheet"[^>]*>/gi,
        (tag) => {
            const m = tag.match(/\bhref="([^"]*)"/);
            const href = m?.[1];
            if (href && cssByHref.has(href)) {
                return `<style>${cssByHref.get(href)}</style>`;
            }
            return tag;
        }
    );
}

/**
 * Rewrites each `<img src="X">` whose src is a key in `dataByUrl` to the mapped
 * data: URI. Images not in the map (external URLs, unresolved paths) are left
 * unchanged. Pure — the caller does the file I/O to build the map.
 */
export function inlineImages(html: string, dataByUrl: Map<string, string>): string {
    // Non-greedy `[^>]*?` binds to the first `src="` so `data-glint-src` (which
    // also ends in "src") cannot be matched instead.
    return html.replace(
        /(<img\b[^>]*?\ssrc=")([^"]*)(")/gi,
        (full, pre: string, src: string, post: string) =>
            dataByUrl.has(src) ? `${pre}${dataByUrl.get(src)}${post}` : full
    );
}

const MIME_BY_EXT: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon',
};

/** Collect every `<img src>` value in the HTML. */
function collectImgSrcs(html: string): string[] {
    const srcs: string[] = [];
    for (const m of html.matchAll(/<img\b[^>]*?\ssrc="([^"]*)"/gi)) srcs.push(m[1]);
    return srcs;
}

export interface RenderFileOptions {
    /** Path to the markdown file to render. */
    filePath: string;
    /** Theme name override (defaults to the config / 'nord'). */
    theme?: string;
    /** KaTeX version for the CDN stylesheet. Resolved from the install if omitted. */
    katexVersion?: string;
    /** Override the config directory (defaults to the file's directory). */
    configPath?: string;
}

/**
 * Render a single markdown file into a self-contained static HTML document:
 * chrome CSS inlined, images inlined as data: URIs, all JS stripped, internal /
 * wiki links inert, and KaTeX loaded from the CDN. Returns the HTML string.
 */
export async function renderFile(opts: RenderFileOptions): Promise<string> {
    const fileDir = path.dirname(opts.filePath);
    const config = await loadConfig(fileDir, opts.configPath);
    if (opts.theme) config.theme = opts.theme;

    const raw = await fs.readFile(opts.filePath, 'utf8');
    const { content, title: fmTitle, frontmatter, contentStartLine } = parseMarkdown(raw);
    const currentPath = path.basename(opts.filePath);

    // No wiki targets are known: every internal link is later stripped to inert
    // text, so the predicate can simply report everything as unknown.
    const processor = createProcessor(config, () => false);
    const file = new VFile({ value: content });
    file.data.contentStartLine = contentStartLine;
    file.data.filePath = currentPath;
    const vfile = await processor.process(file);
    const headings = (vfile.data.headings as HeadingNode[]) || [];
    const title = fmTitle || path.basename(opts.filePath, '.md').replace(/-/g, ' ');

    let html = renderer.renderHtml({
        content: String(vfile),
        title,
        config,
        fileTree: [],
        currentPath,
        headings,
        frontmatter,
        static: true,
        standalone: true,
    });

    const katexVersion = opts.katexVersion ?? (await resolveKatexVersion());
    html = rewriteStaticHtml(html);
    html = stripInternalLinks(html);
    html = applyKatexCdn(html, katexVersion);

    // Inline chrome stylesheets from the bundled assets dir.
    const repoAssets = path.join(import.meta.dirname, '..', 'assets');
    const cssByHref = new Map<string, string>();
    const cssFiles: [string, string][] = [
        ['/assets/layout.css', path.join(repoAssets, 'layout.css')],
        ['/assets/highlight.css', path.join(repoAssets, 'highlight.css')],
        [`/assets/themes/${config.theme}.css`, path.join(repoAssets, 'themes', `${config.theme}.css`)],
    ];
    for (const [href, fsPath] of cssFiles) {
        try {
            cssByHref.set(href, await fs.readFile(fsPath, 'utf8'));
        } catch {
            // Missing stylesheet (e.g. unknown theme): leave the <link> as-is.
        }
    }
    html = inlineStylesheets(html, cssByHref);

    // Inline images as data: URIs. After rewriteStaticHtml, this file's own
    // images are root-absolute paths resolved against the file's directory.
    const dataByUrl = new Map<string, string>();
    for (const src of collectImgSrcs(html)) {
        if (dataByUrl.has(src)) continue;
        if (!src.startsWith('/') || src.startsWith('//') || src.startsWith('/assets/')) continue;
        const ext = path.extname(src).toLowerCase();
        const mime = MIME_BY_EXT[ext];
        if (!mime) continue;
        try {
            const buf = await fs.readFile(path.join(fileDir, src.replace(/^\/+/, '')));
            dataByUrl.set(src, `data:${mime};base64,${buf.toString('base64')}`);
        } catch {
            // Unresolved image: leave it as-is.
        }
    }
    html = inlineImages(html, dataByUrl);

    // Drop the editor-only data-glint-src attribute: it is dead once JS is
    // stripped and would otherwise leak the original asset path.
    html = html.replace(/\sdata-glint-src="[^"]*"/gi, '');

    // Drop client JS. Keep CDN loaders for client-rendered content (mermaid, abcjs).
    const hasMermaid = /<div class="mermaid">/.test(html);
    const hasAbcjs = /class="abcjs-notation"/.test(html);
    html = stripScripts(html, { keepMermaid: hasMermaid, keepAbcjs: hasAbcjs });

    return html;
}

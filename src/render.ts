// src/render.ts
// Single-file renderer: renders one markdown file to a self-contained HTML
// document. Chrome CSS is inlined as <style>, images are inlined as data: URIs,
// all JavaScript is stripped, and KaTeX CSS/fonts load from the CDN. The result
// is one portable .html file with no sidecar assets (fonts excepted).
import path from 'node:path';
import fs from 'node:fs/promises';
import { VFile } from 'vfile';
import { DEFAULTS, readLatexMacros } from './config.js';
import { parseMarkdown } from './markdown.js';
import { createProcessor } from './pipeline.js';
import * as renderer from './renderer.js';
import { rewriteStaticHtml, stripInternalLinks, applyKatexCdn } from './url-rewrite.js';
import { contentBehaviorInit, contentBehaviorLoaders, MERMAID_CDN } from './renderer/content-behavior.js';
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
 * With `keepMermaid`, renderer-owned scripts survive: the shared
 * init block (tagged `data-glint`) and the exact mermaid CDN loader URL.
 * Everything else is dropped — a user `<script>` that merely mentions "mermaid"
 * in its body no longer executes in static output (#65).
 */
export function stripScripts(html: string, opts: { keepMermaid?: boolean } = {}): string {
    const keepInline = opts.keepMermaid;
    return html.replace(/<script\b([^>]*)>[\s\S]*?<\/script>/gi, (tag, attrs: string) => {
        if (keepInline && /\bdata-glint\b/.test(attrs)) return tag;
        const src = attrs.match(/\bsrc="([^"]*)"/i)?.[1];
        if (opts.keepMermaid && src === MERMAID_CDN) return tag;
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

/**
 * Maps GitHub Primer color tokens (which host github-markdown.css reads to style
 * tables, code, borders, links) onto Glint's color scheme variables. Injected into the
 * `--body-only` fragment so an embedding host renders base elements in Glint's
 * palette — see issue #17. Scoped to `.markdown-body`, the host's own wrapper.
 */
const GITHUB_PRIMER_BRIDGE = `.markdown-body{
--color-canvas-default:var(--bg-color);
--color-canvas-subtle:var(--bg-dim);
--color-fg-default:var(--text-color);
--color-fg-muted:var(--text-dim);
--color-fg-subtle:var(--text-dim);
--color-border-default:var(--border-color);
--color-border-muted:var(--border-color);
--color-neutral-muted:var(--bg-highlight);
--color-accent-fg:var(--blue);
}`;

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
    /** Color scheme name override (defaults to the config / 'nord'). */
    colorScheme?: string;
    /** KaTeX version for the CDN stylesheet. Resolved from the install if omitted. */
    katexVersion?: string;
}

export interface RenderMarkdownOptions {
    /** Raw markdown string to render. */
    markdown: string;
    /** Directory used for image resolution (defaults to cwd). */
    fileDir?: string;
    /** Color scheme name override (defaults to the config / 'nord'). */
    colorScheme?: string;
    /** KaTeX version for the CDN stylesheet. Resolved from the install if omitted. */
    katexVersion?: string;
    /**
     * When true, emit a body fragment for embedding in an external page template
     * (VimR's Markdown preview) instead of a full-page document: inlined CSS,
     * KaTeX CDN link, conditional mermaid loader, and inline widget
     * interaction. The fragment forces Glint's own color scheme so it reads as a
     * self-contained island; pair with `colorScheme: 'nvim'` to instead inherit the
     * host editor's colorscheme. VimR substitutes this verbatim into its own
     * `<body class="markdown-body">`.
     */
    bodyOnly?: boolean;
}

/**
 * Render a single markdown file into a self-contained static HTML document:
 * chrome CSS inlined, images inlined as data: URIs, all JS stripped, internal /
 * wiki links inert, and KaTeX loaded from the CDN. Returns the HTML string.
 */
export async function renderFile(opts: RenderFileOptions): Promise<string> {
    const fileDir = path.dirname(opts.filePath);
    const config = { ...DEFAULTS };
    if (opts.colorScheme) config.colorScheme = opts.colorScheme;

    const raw = await fs.readFile(opts.filePath, 'utf8');
    const { content, title: fmTitle, frontmatter, contentStartLine } = parseMarkdown(raw);
    config['latex-macros'] = readLatexMacros(frontmatter);
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
        currentPath,
        headings,
        frontmatter,
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
        [`/assets/color-schemes/${config.colorScheme}.css`, path.join(repoAssets, 'color-schemes', `${config.colorScheme}.css`)],
    ];
    for (const [href, fsPath] of cssFiles) {
        try {
            cssByHref.set(href, await fs.readFile(fsPath, 'utf8'));
        } catch {
            // Missing stylesheet (e.g. unknown color scheme): leave the <link> as-is.
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

    // Drop client JS. Keep CDN loaders for client-rendered content (mermaid).
    const hasMermaid = /<div class="mermaid">/.test(html);
    html = stripScripts(html, { keepMermaid: hasMermaid });

    return html;
}

/** Render a raw markdown string to a full static HTML document (or a VimR fragment when nvim). */
export async function renderMarkdown(opts: RenderMarkdownOptions): Promise<string> {
    const config = { ...DEFAULTS };
    if (opts.colorScheme) config.colorScheme = opts.colorScheme;

    const { content, frontmatter, contentStartLine, title: fmTitle } = parseMarkdown(
        opts.markdown,
        opts.bodyOnly ? false : true  // ponytail: keep H1 in the fragment — VimR has no other title
    );
    config['latex-macros'] = readLatexMacros(frontmatter);
    const currentPath = 'stdin.md';

    const processor = createProcessor(config, () => false);
    const file = new VFile({ value: content });
    file.data.contentStartLine = contentStartLine;
    file.data.filePath = currentPath;
    const vfile = await processor.process(file);

    const katexVersion = opts.katexVersion ?? (await resolveKatexVersion());
    const repoAssets = path.join(import.meta.dirname, '..', 'assets');
    const cssFiles: [string, string][] = [
        ['/assets/layout.css', path.join(repoAssets, 'layout.css')],
        ['/assets/highlight.css', path.join(repoAssets, 'highlight.css')],
        [`/assets/color-schemes/${config.colorScheme}.css`, path.join(repoAssets, 'color-schemes', `${config.colorScheme}.css`)],
    ];

    if (opts.bodyOnly) {
        // Body fragment: inlined CSS + KaTeX + raw pipeline output, for embedding
        // in an external template. VimR substitutes it into its own
        // <body class="markdown-body">.
        const cssParts: string[] = [];
        for (const [, fsPath] of cssFiles) {
            try { cssParts.push(await fs.readFile(fsPath, 'utf8')); } catch { /* skip */ }
        }
        // Reset layout.css's full-page app-shell rules (html/body 100vh + overflow:hidden
        // + flex) that break VimR's document flow — both html AND body need the
        // height/overflow reset or the page can't scroll — and force Glint's own
        // color scheme over the host's `.markdown-body` (which outranks a bare
        // `body` selector) so the fragment reads as a self-contained color-schemed island.
        // With `--color-scheme=nvim` these vars resolve to the editor's colorscheme, so
        // the same rule instead makes the fragment match its host.
        cssParts.push('html,body{height:auto!important;overflow:visible!important;}body{display:block!important;max-width:none!important;padding:1rem 1.25rem!important;background:var(--bg-color)!important;color:var(--text-color)!important;}');
        // Drive the host's github-markdown.css from Glint's palette (issue #17):
        // it styles base elements (tables, code, borders) from GitHub Primer tokens,
        // and its `.markdown-body …` rules out-specify ours. Rather than fight those
        // selectors, we set the tokens — github then renders base elements in Glint's
        // colors via its own rules. Scoped to `.markdown-body` and emitted after
        // github-markdown (head), so it wins by source order at equal specificity.
        cssParts.push(GITHUB_PRIMER_BRIDGE);
        const katexLink = `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@${katexVersion}/dist/katex.min.css">`;
        // Glint's fonts (layout.css asks for Inter / JetBrains Mono). VimR's own
        // template doesn't load them, so without this code falls back to the
        // platform default monospace. Body text still follows VimR's `.markdown-body`
        // font, which outranks layout.css by specificity — this only fixes the gaps.
        const fontLinks = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Outfit:wght@500;700&display=swap" rel="stylesheet">`;
        const styleBlock = cssParts.length ? `<style>${cssParts.join('\n')}</style>` : '';

        let body = String(vfile);
        body = body.replace(/\sdata-glint-src="[^"]*"/gi, '');

        // Inline widget interaction (comment/code collapse). This is fragment-only:
        // VimR loads from file:// so the app's /assets bundles can't be linked, and
        // the read-only page has no comment-collapse handler of its own to share.
        // Container class is `.glint-comment` (widgets/comment.ts) — NOT
        // `.glint-comment-block`; the assertion in render.test.ts guards the drift.
        const widgetScript = `<script>
document.addEventListener('click',function(e){
  var t=e.target.closest('.comment-collapse-toggle');
  if(t){var b=t.closest('.glint-comment');if(b){var c=b.getAttribute('data-collapsed')==='true';b.setAttribute('data-collapsed',c?'false':'true');}}
  var cc=e.target.closest('.code-collapse-toggle');
  if(cc){var w=cc.closest('.code-block-wrapper');if(w){w.classList.toggle('collapsed');}}
});
</script>`;

        // Mermaid: shared loaders + init (renderer/content-behavior.ts),
        // gated so plain documents pull no CDN libraries.
        const clientScripts = `${widgetScript}\n${contentBehaviorLoaders(body)}\n${contentBehaviorInit()}`;
        // Render the article header (title + frontmatter metadata) matching the full Glint page.
        const { renderMetadata } = await import('./renderer/metadata.js');
        const { escapeHtml } = await import('./utils/html.js');
        // Only use an *explicit* frontmatter title for the header. `fmTitle` also
        // falls back to the first H1, but stripH1 is false here (we keep the H1 in
        // the body), so using the fallback would render that H1 twice.
        const explicitTitle = typeof frontmatter.title === 'string' ? frontmatter.title : null;
        const titleHtml = explicitTitle ? `<h1>${escapeHtml(explicitTitle)}</h1>\n` : '';
        const metaHtml = renderMetadata(frontmatter);
        const headerHtml = (titleHtml || metaHtml)
            ? `<header class="article-header">${titleHtml}${metaHtml}<div class="title-accent"></div></header>\n`
            : '';
        return `${fontLinks}\n${styleBlock}\n${katexLink}\n${clientScripts}\n${headerHtml}${body}`;
    }

    const headings = (vfile.data.headings as HeadingNode[]) ?? [];
    const title = fmTitle ?? 'Document';

    let html = renderer.renderHtml({
        content: String(vfile),
        title,
        config,
        currentPath,
        headings,
        frontmatter,
    });

    html = rewriteStaticHtml(html);
    html = stripInternalLinks(html);
    html = applyKatexCdn(html, katexVersion);

    const cssByHref = new Map<string, string>();
    for (const [href, fsPath] of cssFiles) {
        try { cssByHref.set(href, await fs.readFile(fsPath, 'utf8')); } catch { /* skip */ }
    }
    html = inlineStylesheets(html, cssByHref);
    html = html.replace(/\sdata-glint-src="[^"]*"/gi, '');

    const hasMermaid = /<div class="mermaid">/.test(html);
    html = stripScripts(html, { keepMermaid: hasMermaid });

    return html;
}

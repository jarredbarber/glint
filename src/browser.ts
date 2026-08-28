import { VFile } from 'vfile';
import { parseMarkdown } from './markdown.js';
import { renderTitle } from './renderer/title.js';
import { readLatexMacros } from './config.js';
import { createProcessor, type GlintConfig } from './pipeline.js';
import { escapeHtml } from './utils/html.js';
import { renderMetadata } from './renderer/metadata.js';

// Keys renderMetadata already presents (plus `title`, which #67 demotes to metadata but
// is redundant with the H1). Everything else is dumped as a labelled key/value grid so
// arbitrary frontmatter still shows up aesthetically (#67).
const KNOWN_META_KEYS = new Set([
    'title', 'date', 'updated', 'modified', 'author', 'category', 'tags',
    'description', 'summary', 'reading-time', 'image', 'thumbnail', 'draft', 'latex-macros',
]);

function renderExtraMetadata(frontmatter: Record<string, unknown>): string {
    const rows = Object.entries(frontmatter)
        .filter(([key, value]) => !KNOWN_META_KEYS.has(key) && value != null && value !== '')
        .map(([key, value]) => {
            const shown = Array.isArray(value) ? value.join(', ') : String(value);
            return `<div class="meta-field"><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(shown)}</dd></div>`;
        });
    return rows.length ? `<dl class="article-fields">${rows.join('')}</dl>` : '';
}

export { drawContentBehaviors } from './renderer/content-behavior.js';

export interface RenderOptions {
    /** KaTeX macros, e.g. { '\\R': '\\mathbb{R}' } */
    macros?: Record<string, string>;
    /** Color scheme name (affects nothing in pure HTML output; reserved for future use) */
    colorScheme?: string;
    /** Base URL for resolving relative image paths (default: '') */
    baseUrl?: string;
    /** Known document paths for wiki-link validation (default: all links treated as unknown) */
    knownPaths?: string[];
    /** Backend metadata used as fallback when frontmatter omits the field (#87). Frontmatter wins. */
    defaultMeta?: { author?: string; updated?: string };
}

const DEFAULT_CONFIG: GlintConfig = {
    colorScheme: 'nord',
    baseFile: 'README.md',
};

/**
 * Render a markdown string to an HTML string using the full Glint pipeline.
 * Runs entirely in the browser — no server required.
 *
 * Widgets (tasks, comments) render as static markup.
 * Wiki-links whose targets are not in knownPaths render as plain text.
 * Mermaid emits placeholder markup; the host page must load
 * the CDN loader to draw it.
 */
export async function renderMarkdown(source: string, opts: RenderOptions = {}): Promise<string> {
    // Parse first because document-local KaTeX macros are render configuration.
    const { content, title, frontmatter, contentStartLine } = parseMarkdown(source);

    const config: GlintConfig = {
        ...DEFAULT_CONFIG,
        colorScheme: opts.colorScheme ?? DEFAULT_CONFIG.colorScheme,
        'latex-macros': { ...readLatexMacros(frontmatter), ...opts.macros },
    };

    const knownSet = new Set(opts.knownPaths ?? []);
    const processor = createProcessor(config, (p) => knownSet.has(p), 'spa');

    const file = new VFile({ value: content });
    file.data.contentStartLine = contentStartLine;
    // Static SPA: keep relative image src as-is instead of the CLI's
    // /api/asset/resolve intermediate, which has no server to hit here (#65).
    file.data.rawAssetSrc = true;
    if (opts.baseUrl) file.data.baseUrl = opts.baseUrl;

    const result = await processor.process(file);
    const titleHtml = title ? `<h1 class="glint-doc-title">${renderTitle(title, config['latex-macros'] ?? {})}</h1>` : '';
    // Backend metadata fills in only what frontmatter leaves out (#87). Drop empty
    // defaults so `{ ...{author: undefined}, ...fm }` can't shadow a real value.
    const defaults = Object.fromEntries(Object.entries(opts.defaultMeta ?? {}).filter(([, v]) => v));
    const metaHtml = renderMetadata({ ...defaults, ...frontmatter }) + renderExtraMetadata(frontmatter);
    const header = (titleHtml || metaHtml)
        ? `<header class="article-header">${titleHtml}${metaHtml}</header>`
        : '';
    return header + String(result);
}

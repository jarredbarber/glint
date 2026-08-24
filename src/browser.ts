import { VFile } from 'vfile';
import { parseMarkdown } from './markdown.js';
import { createProcessor, type GlintConfig } from './pipeline.js';

export { drawContentBehaviors } from './renderer/content-behavior.js';

export interface RenderOptions {
    /** KaTeX macros, e.g. { '\\R': '\\mathbb{R}' } */
    macros?: Record<string, string>;
    /** Theme name (affects nothing in pure HTML output; reserved for future use) */
    theme?: string;
    /** Base URL for resolving relative image paths (default: '') */
    baseUrl?: string;
    /** Known document paths for wiki-link validation (default: all links treated as unknown) */
    knownPaths?: string[];
}

const DEFAULT_CONFIG: GlintConfig = {
    theme: 'nord',
    baseFile: 'README.md',
};

/**
 * Render a markdown string to an HTML string using the full Glint pipeline.
 * Runs entirely in the browser — no server required.
 *
 * Widgets (tasks, comments) render as static markup.
 * Wiki-links whose targets are not in knownPaths render as plain text.
 * Mermaid and abcjs emit their placeholder markup; the host page must load
 * the respective CDN loaders to draw them.
 */
export async function renderMarkdown(source: string, opts: RenderOptions = {}): Promise<string> {
    const config: GlintConfig = {
        ...DEFAULT_CONFIG,
        theme: opts.theme ?? DEFAULT_CONFIG.theme,
        'latex-macros': opts.macros,
    };

    const knownSet = new Set(opts.knownPaths ?? []);
    const processor = createProcessor(config, (p) => knownSet.has(p));

    const { content, contentStartLine } = parseMarkdown(source);
    const file = new VFile({ value: content });
    file.data.contentStartLine = contentStartLine;
    if (opts.baseUrl) file.data.baseUrl = opts.baseUrl;

    const result = await processor.process(file);
    return String(result);
}

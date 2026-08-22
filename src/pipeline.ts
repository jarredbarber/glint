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
import rehypeKatex from 'rehype-katex';
import { rehypeExtractHeadings } from './rehype-extract-headings.js';
import { remarkMermaidGlint } from './remark-mermaid-glint.js';
import { remarkAbcjsGlint } from './remark-abcjs-glint.js';
import { remarkWikiLinkGlint } from './remark-wiki-link-glint.js';
import { remarkGlintWidgets } from './remark-glint-widgets.js';
import { rehypeSourceLines } from './rehype-source-lines.js';
import { rehypeGlintSections } from './rehype-glint-sections.js';
import { rehypeGlintImage } from './rehype-glint-image.js';
import { rehypeGlintCodeBlocks } from './rehype-glint-code-blocks.js';
import { remarkGlintCitations } from './remark-glint-citations.js';
import { rehypeGlintCitations } from './rehype-glint-citations.js';
import type { GlintConfig } from './config.js';

export type { GlintConfig };

function getProcessedMacros(config: GlintConfig): Record<string, string> {
    const rawMacros = config['latex-macros'] ?? {};
    const processed: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawMacros)) {
        processed[key.startsWith('\\') ? key : `\\${key}`] = value;
    }
    return processed;
}

export function createProcessor(config: GlintConfig, linkValidator: (path: string) => boolean) {
    const macros = getProcessedMacros(config);

    return unified()
        .use(remarkParse)
        .use(remarkMath)
        .use(remarkGfm)
        .use(remarkGlintWidgets)
        .use(remarkGlintCitations)
        .use(remarkWikiLinkGlint, { validateLink: linkValidator })
        .use(remarkMermaidGlint)
        .use(remarkAbcjsGlint)
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

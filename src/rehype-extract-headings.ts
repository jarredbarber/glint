import type { Plugin } from 'unified';
import type { Root, Element, ElementContent } from 'hast';
import { visit } from 'unist-util-visit';

export interface HeadingNode {
    depth: number;
    text: string;
    id: string;
}

// Collect visible text, skipping KaTeX's non-visual duplicates. rehypeKatex runs
// before extraction, so a heading's `$\alpha$` is already a .katex subtree that
// carries the visual glyph (.katex-html) plus a MathML copy with the raw TeX in an
// <annotation>. hast-util-to-text would concatenate all three (α\alphaα); prune the
// MathML/annotation branches so only the rendered glyph survives. (#135)
function headingText(node: ElementContent | Element): string {
    if (node.type === 'text') return node.value;
    if (node.type !== 'element') return '';
    const cls = node.properties?.className;
    const classes = Array.isArray(cls) ? cls : typeof cls === 'string' ? cls.split(/\s+/) : [];
    if (node.tagName === 'annotation' || classes.includes('katex-mathml')) return '';
    return node.children.map(headingText).join('');
}

declare module 'vfile' {
    interface DataMap {
        headings: HeadingNode[];
    }
}

/**
 * Rehype plugin to extract headings (h1-h6) from the HTML AST.
 * Expects 'id' properties to be present (e.g. from rehype-slug).
 * populates file.data.headings with the extracted data.
 */
export const rehypeExtractHeadings: Plugin<[], Root> = function () {
    return (tree: Root, file) => {
        const headings: HeadingNode[] = [];

        visit(tree, 'element', (node: Element) => {
            const tagName = node.tagName;
            if (/^h[1-6]$/.test(tagName)) {
                const depth = parseInt(tagName.charAt(1), 10);
                const text = headingText(node).trim();
                const id = (node.properties?.id as string) || '';

                if (text && id) {
                    headings.push({ depth, text, id });
                }
            }
        });

        file.data.headings = headings;
    };
};

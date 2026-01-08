import type { Plugin } from 'unified';
import type { Root, Element } from 'hast';
import { visit } from 'unist-util-visit';
import { toText } from 'hast-util-to-text';

export interface HeadingNode {
    depth: number;
    text: string;
    id: string;
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
                const text = toText(node);
                const id = (node.properties?.id as string) || '';

                if (text && id) {
                    headings.push({ depth, text, id });
                }
            }
        });

        file.data.headings = headings;
    };
};

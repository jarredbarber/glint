import type { Plugin } from 'unified';
import type { Root, Code, Html } from 'mdast';
import { visit } from 'unist-util-visit';
import { escapeHtml } from './utils/html.js';

/**
 * Remark plugin to transform code blocks with language 'mermaid'
 * into div elements with class 'mermaid' for client-side rendering.
 */
export const remarkMermaidGlint: Plugin<[], Root> = function () {
    return (tree: Root) => {
        visit(tree, 'code', (node: Code, index, parent) => {
            if (node.lang === 'mermaid' && parent && index !== undefined) {
                // Convert to HTML node
                const htmlNode: Html = {
                    type: 'html',
                    value: `<div class="mermaid">${escapeHtml(node.value)}</div>`
                };

                // Replace the code node with the html node
                parent.children.splice(index, 1, htmlNode);
            }
        });
    };
};

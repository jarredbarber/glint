import type { Plugin } from 'unified';
import type { Root, Code, Html } from 'mdast';
import { visit } from 'unist-util-visit';
import { escapeHtml } from './utils/html.js';

let abcCounter = 0;

export const remarkAbcjsGlint: Plugin<[], Root> = function () {
    return (tree: Root) => {
        visit(tree, 'code', (node: Code, index, parent) => {
            if (node.lang !== 'abcjs' && node.lang !== 'abc') return;
            if (!parent || index === undefined) return;

            const id = `abcjs-target-${abcCounter++}`;
            const htmlNode: Html = {
                type: 'html',
                value: `<div class="abcjs-wrapper"><div id="${id}" class="abcjs-notation" data-abc="${escapeHtml(node.value)}"></div></div>`
            };
            parent.children.splice(index, 1, htmlNode);
        });
    };
};

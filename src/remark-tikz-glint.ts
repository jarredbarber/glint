import type { Plugin } from 'unified';
import type { Root, Code, Html } from 'mdast';
import { visit } from 'unist-util-visit';

/**
 * Remark plugin: turn ```tikz code fences into the `<script type="text/tikz">`
 * elements the vendored TikZJax loader compiles to SVG in the browser. The loader
 * (assets/tikzjax/tikzjax.js) is only fetched when such an element is present; see
 * content-behavior.ts. TeX is emitted raw (not HTML-escaped): script raw-text mode
 * leaves backslashes/braces alone, and TeX never contains the `</script>` sequence
 * that would end the element early.
 */
export const remarkTikzGlint: Plugin<[], Root> = function () {
    return (tree: Root) => {
        visit(tree, 'code', (node: Code, index, parent) => {
            if (node.lang === 'tikz' && parent && index !== undefined) {
                // Wrap in a centered figure so the SVG TikZJax swaps in for the
                // script isn't left-aligned. The classifier in rehype-content-policy.ts
                // keeps this Glint-generated wrapper raw alongside the script.
                const htmlNode: Html = {
                    type: 'html',
                    value: `<div class="tikz-figure"><script type="text/tikz" data-glint>\n${node.value}\n</script></div>`,
                };
                parent.children.splice(index, 1, htmlNode);
            }
        });
    };
};

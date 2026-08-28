/**
 * Rehype plugin that anchors labeled equations (#108).
 *
 * rehype-katex replaces the math node wholesale, so the id can't be set in
 * remark. Instead we walk the rendered `.katex-display` blocks in document
 * order and pair them with the labels recorded by remark-glint-eqrefs.
 */

import { visit } from 'unist-util-visit';
import type { Plugin } from 'unified';
import type { Root, Element } from 'hast';
import type { VFile } from 'vfile';
import type { EqLabelData } from './remark-glint-eqrefs.js';

function hasClass(node: Element, name: string): boolean {
    const cn = node.properties?.className;
    return Array.isArray(cn) && cn.includes(name);
}

export const rehypeGlintEqrefs: Plugin<[], Root> = function () {
    return (tree: Root, file: VFile) => {
        const data = file.data.eqLabels as EqLabelData | undefined;
        if (!data || data.anchors.size === 0) return;

        let displayIndex = -1;
        visit(tree, 'element', (node: Element) => {
            if (!hasClass(node, 'katex-display')) return;
            displayIndex++;
            const key = data.anchors.get(displayIndex);
            if (!key) return;
            node.properties = node.properties || {};
            node.properties.id = `eq-${key}`;
            const cn = node.properties.className;
            node.properties.className = Array.isArray(cn) ? [...cn, 'glint-eq'] : ['katex-display', 'glint-eq'];
        });
    };
};

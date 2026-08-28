/**
 * Remark plugin for equation labels and cross-references (#108).
 *
 * Declare a label on a display equation with `\label{eq:key}`. Glint assigns
 * it the next sequential number, renders that number via `\tag{n}`, and lets
 * you reference it in prose with `[[#eq:key]]`, which links to the equation.
 *
 * Scope: single display equations (`$$ ... $$`). Labels inside multi-row
 * environments like `align` are not numbered here — KaTeX owns that numbering.
 */

import { visit } from 'unist-util-visit';
import type { Plugin } from 'unified';
import type { Root, Text, PhrasingContent } from 'mdast';
import type { VFile } from 'vfile';
import { escapeHtml } from './utils/html.js';

export interface EqLabelData {
    /** label key -> assigned equation number */
    numbers: Map<string, number>;
    /** display-math ordinal (0-based) -> label key, for anchoring after KaTeX */
    anchors: Map<number, string>;
}

declare module 'vfile' {
    interface DataMap {
        eqLabels: EqLabelData;
    }
}

const LABEL_RE = /\\label\s*\{([^}]+)\}/;

/**
 * Write the TeX back onto a math node. remark-math bakes the source into
 * `data.hChildren` at parse time, and remark-rehype reads that, not `.value` —
 * so both must be updated for the change to reach KaTeX.
 */
function setMathTex(node: any, tex: string): void {
    node.value = tex;
    const textNode = node.data?.hChildren?.[0]?.children?.[0];
    if (textNode && typeof textNode.value === 'string') textNode.value = tex;
}

export const remarkGlintEqrefs: Plugin<[], Root> = function () {
    return (tree: Root, file: VFile) => {
        const data: EqLabelData = { numbers: new Map(), anchors: new Map() };
        let nextNumber = 1;
        let displayIndex = -1;

        // Pass 1: number labeled display equations and inject their tags.
        visit(tree, 'math' as any, (node: any) => {
            displayIndex++;
            const value: string = node.value ?? '';
            const match = value.match(LABEL_RE);
            if (!match) return;

            // Normalize a leading `eq:` so LaTeX-style `\label{eq:mass}` and the
            // `[[#eq:mass]]` reference resolve to the same key (`mass`).
            const key = match[1].trim().replace(/^eq:/, '');
            // Strip the \label; KaTeX would otherwise choke on it.
            let stripped = value.replace(LABEL_RE, '').trim();

            // ponytail: single-equation scope. Environments own their own
            // numbering, so a \tag appended after \end{...} would be invalid.
            const isEnvironment = /\\begin\s*\{/.test(stripped);
            if (isEnvironment || data.numbers.has(key)) {
                setMathTex(node, stripped); // first label wins; drop duplicates silently
                return;
            }

            const number = nextNumber++;
            data.numbers.set(key, number);
            data.anchors.set(displayIndex, key);
            setMathTex(node, `${stripped} \\tag{${number}}`);
        });

        // Pass 2: resolve [[#eq:key]] references (forward refs work — numbers
        // are all assigned above).
        visit(tree, 'text', (node: Text, index, parent) => {
            if (!parent || index === undefined) return;

            const value = node.value;
            const regex = /\[\[#eq:([^\]]+)\]\]/g;
            const newNodes: PhrasingContent[] = [];
            let lastIndex = 0;
            let match: RegExpExecArray | null;

            while ((match = regex.exec(value)) !== null) {
                if (match.index > lastIndex) {
                    newNodes.push({ type: 'text', value: value.slice(lastIndex, match.index) });
                }
                const key = match[1].trim().replace(/^eq:/, '');
                const number = data.numbers.get(key);
                const safeKey = escapeHtml(key);
                newNodes.push({
                    type: 'html',
                    value: number
                        ? `<a class="glint-eqref" href="#eq-${safeKey}">(${number})</a>`
                        : `<a class="glint-eqref broken-link">(?)</a>`,
                } as any);
                lastIndex = regex.lastIndex;
            }

            if (newNodes.length > 0) {
                if (lastIndex < value.length) {
                    newNodes.push({ type: 'text', value: value.slice(lastIndex) });
                }
                parent.children.splice(index, 1, ...newNodes);
                return index + newNodes.length;
            }
        });

        file.data.eqLabels = data;
    };
};

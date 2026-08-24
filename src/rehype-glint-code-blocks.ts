import { visit } from 'unist-util-visit';
import { Root, Element } from 'hast';

/**
 * REHYPE GLINT CODE BLOCKS PLUGIN
 * 
 * 1. Wraps all <pre> blocks in a container.
 * 2. Adds a Copy button to all blocks.
 * 3. Adds a Collapse toggle for long blocks (>15 lines).
 */
export function rehypeGlintCodeBlocks() {
    const LINE_THRESHOLD = 15;

    return (tree: Root) => {
        visit(tree, 'element', (node: Element, index, parent) => {
            if (node.tagName !== 'pre') return;
            if (!parent || index === undefined) return;

            // Find child <code> element
            const code = node.children.find(c => c.type === 'element' && c.tagName === 'code') as Element | undefined;
            if (!code) return;

            // Count lines
            let lineCount = 0;
            const visitText = (child: any) => {
                if (child.type === 'text') {
                    lineCount += (child.value.match(/\n/g) || []).length;
                } else if (child.children) {
                    child.children.forEach(visitText);
                }
            };
            code.children.forEach(visitText);

            const children: Element[] = [{ ...node }];

            // Add Copy button
            children.push({
                type: 'element',
                tagName: 'div',
                properties: { className: ['code-copy-button'] },
                children: [{ type: 'text', value: 'Copy' }]
            });

            // Add a collapse toggle for long blocks. Blocks render expanded by default;
            // the label is CSS-driven (::after) so it reads correctly in either state.
            const isLong = lineCount > LINE_THRESHOLD;
            if (isLong) {
                children.push({
                    type: 'element',
                    tagName: 'div',
                    properties: { className: ['code-collapse-toggle'] },
                    children: []
                });
            }

            const wrapper: Element = {
                type: 'element',
                tagName: 'div',
                properties: {
                    className: ['code-block-wrapper', isLong ? 'collapsible' : ''].filter(Boolean),
                    'data-line-count': lineCount.toString()
                },
                children
            };

            parent.children[index] = wrapper;
        });
    };
}

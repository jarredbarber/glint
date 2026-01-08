import { visit } from 'unist-util-visit';
import type { Plugin } from 'unified';
import type { Root, ListItem, Paragraph, Text, Html } from 'mdast';

/**
 * Remark plugin to transform list items starting with `[/]` into 
 * custom checkbox inputs with `data-state="in-progress"`.
 */
export const remarkSlashCheckbox: Plugin<[], Root> = function () {
    return (tree: Root) => {
        visit(tree, 'listItem', (node: ListItem) => {
            // Check first child is paragraph
            const paragraph = node.children[0];
            if (!paragraph || paragraph.type !== 'paragraph') return;

            // Check first child of paragraph is text
            const textNode = paragraph.children[0];
            if (!textNode || textNode.type !== 'text') return;

            // Match `[/]` at start
            const match = textNode.value.match(/^\[\/\]\s*/);
            if (match) {
                // Remove marker from text
                textNode.value = textNode.value.slice(match[0].length);

                // Add class to list item via data properties (for rehype)
                const data = node.data || (node.data = {});
                const hProperties = data.hProperties || (data.hProperties = {});
                // Standard GFM class for task lists
                hProperties.className = ['task-list-item'];

                // Create custom input node
                const inputNode: Html = {
                    type: 'html',
                    value: '<input type="checkbox" disabled data-state="in-progress">'
                };

                // Prepend input to paragraph
                paragraph.children.unshift(inputNode);
            }
        });
    };
};

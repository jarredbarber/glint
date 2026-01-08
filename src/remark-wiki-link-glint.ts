import { visit } from 'unist-util-visit';
import type { Plugin } from 'unified';
import type { Root, Text, PhrasingContent } from 'mdast';

/**
 * Remark plugin to transform [[Wiki Links]] into standard markdown links.
 * Supports:
 * - [[Page Name]] -> [Page Name](Page%20Name)
 * - [[Page Name|Label]] -> [Label](Page%20Name)
 */
export const remarkWikiLinkGlint: Plugin<[], Root> = function () {
    return (tree: Root) => {
        visit(tree, 'text', (node: Text, index, parent) => {
            if (!parent || index === undefined) return;

            const value = node.value;
            // Regex to match [[Target]] or [[Target|Label]]
            // Use [^\]|]+ to match anything except ] or |
            const regex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

            let match;
            const newNodes: PhrasingContent[] = [];
            let lastIndex = 0;

            // Find all matches in this text node
            while ((match = regex.exec(value)) !== null) {
                // 1. Push text before the match
                if (match.index > lastIndex) {
                    newNodes.push({
                        type: 'text',
                        value: value.slice(lastIndex, match.index)
                    });
                }

                // 2. Create the link node
                const target = match[1].trim();
                const label = (match[2] || target).trim();

                // Simple URL encoding (spaces to %20, etc.)
                // In a real app, this might resolve against a file index
                const url = encodeURI(target);

                newNodes.push({
                    type: 'link',
                    url: url,
                    title: null,
                    children: [{ type: 'text', value: label }],
                    data: { hProperties: { className: ['internal-link'] } } // Add class for styling
                });

                lastIndex = regex.lastIndex;
            }

            // If we found any matches, proceed to replace the node
            if (newNodes.length > 0) {
                // 3. Push remaining text after the last match
                if (lastIndex < value.length) {
                    newNodes.push({
                        type: 'text',
                        value: value.slice(lastIndex)
                    });
                }

                // Replace the original text node with our new list of nodes
                parent.children.splice(index, 1, ...newNodes);

                // Return the next index to visit (skip the nodes we just added)
                // We added newNodes.length nodes, replacing 1. 
                // Next visit should be at index + newNodes.length
                return index + newNodes.length;
            }
        });
    };
};

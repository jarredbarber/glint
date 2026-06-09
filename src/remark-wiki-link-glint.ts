import { visit } from 'unist-util-visit';
import type { Plugin } from 'unified';
import type { Root, Text, PhrasingContent } from 'mdast';

export interface WikiLinkOptions {
    /**
     * Callback to check if a link target exists.
     * Should return true if the file exists.
     */
    validateLink?: (target: string) => boolean;
}

/**
 * Remark plugin to transform [[Wiki Links]] into standard markdown links.
 * Supports:
 * - [[Page Name]] -> [Page Name](Page%20Name)
 * - [[Page Name|Label]] -> [Label](Page%20Name)
 *
 * If validateLink is provided, it validates if the target file exists.
 */
export const remarkWikiLinkGlint: Plugin<[WikiLinkOptions?], Root> = function (options = {}) {
    const { validateLink } = options;

    return (tree: Root) => {
        visit(tree, 'text', (node: Text, index, parent) => {
            if (!parent || index === undefined) return;

            const value = node.value;
            const regex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

            let match;
            const newNodes: PhrasingContent[] = [];
            let lastIndex = 0;

            while ((match = regex.exec(value)) !== null) {
                if (match.index > lastIndex) {
                    newNodes.push({
                        type: 'text',
                        value: value.slice(lastIndex, match.index)
                    });
                }

                const target = match[1].trim();
                const label = (match[2] || target).trim();

                const targetFile = target.endsWith('.md') ? target : `${target}.md`;
                const url = `/f/${encodeURI(targetFile)}`;

                let exists = true;
                if (validateLink) {
                    exists = validateLink(targetFile);
                }

                newNodes.push({
                    type: 'link',
                    url: url,
                    title: null,
                    children: [{ type: 'text', value: label }],
                    data: {
                        hProperties: {
                            className: ['internal-link', !exists ? 'broken-link' : ''].filter(Boolean)
                        }
                    }
                });

                lastIndex = regex.lastIndex;
            }

            if (newNodes.length > 0) {
                if (lastIndex < value.length) {
                    newNodes.push({
                        type: 'text',
                        value: value.slice(lastIndex)
                    });
                }
                parent.children.splice(index, 1, ...newNodes);
                return index + newNodes.length;
            }
        });
    };
};

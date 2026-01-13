import fs from 'node:fs';
import path from 'node:path';
import { visit } from 'unist-util-visit';
import type { Plugin } from 'unified';
import type { Root, Text, PhrasingContent } from 'mdast';

interface WikiLinkOptions {
    contentDir?: string;
}

/**
 * Remark plugin to transform [[Wiki Links]] into standard markdown links.
 * Supports:
 * - [[Page Name]] -> [Page Name](Page%20Name)
 * - [[Page Name|Label]] -> [Label](Page%20Name)
 * 
 * If contentDir is provided, it validates if the target file exists.
 */
export const remarkWikiLinkGlint: Plugin<[WikiLinkOptions?], Root> = function (options = {}) {
    const { contentDir } = options;

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

                // Simple URL encoding
                const url = encodeURI(target);

                // Existence check
                let exists = true;
                if (contentDir) {
                    // Normalize target to a file path
                    // We assume it's relative to content root or a simple name
                    // In Glint, wiki links usually map to filenames in the root or subdirs
                    // We'll check for Target.md
                    const targetFile = target.endsWith('.md') ? target : `${target}.md`;
                    const fullPath = path.resolve(contentDir, targetFile);

                    // Basic check: must be inside contentDir
                    if (fullPath.startsWith(path.resolve(contentDir))) {
                        exists = fs.existsSync(fullPath);
                    } else {
                        exists = false;
                    }
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

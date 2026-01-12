/**
 * Remark plugin to parse and transform Glint-style citations.
 * 
 * Inline citations: [[#ref:id]] -> <cite data-ref="id">[NUMBER]</cite>
 * References section: ## References with list items
 */

import { visit } from 'unist-util-visit';
import type { Plugin } from 'unified';
import type { Root, Text, PhrasingContent, Heading, List, ListItem, Paragraph, Link } from 'mdast';
import type { VFile } from 'vfile';

export interface Reference {
    id: string;
    title: string;
    author?: string;
    year?: string;
    url?: string;
    raw: string;
}

export interface CitationData {
    references: Map<string, Reference>;
    citationOrder: string[];
}

declare module 'vfile' {
    interface DataMap {
        citations: CitationData;
    }
}

/**
 * Parse a reference list item.
 * Format: [ref:id] "Title" Author (Year) URL
 */
function parseReference(text: string): Reference | null {
    // Match [ref:id]
    const idMatch = text.match(/^\s*\[ref:([^\]]+)\]\s*/);
    if (!idMatch) return null;

    const id = idMatch[1].trim();
    let remainder = text.slice(idMatch[0].length);

    // Match "Title"
    const titleMatch = remainder.match(/^"([^"]+)"\s*/);
    const title = titleMatch ? titleMatch[1] : 'Untitled';
    if (titleMatch) remainder = remainder.slice(titleMatch[0].length);

    // Match (Year) anywhere in the remainder
    const yearMatch = remainder.match(/\((\d{4})\)/);
    const year = yearMatch ? yearMatch[1] : undefined;
    if (yearMatch) remainder = remainder.replace(yearMatch[0], '').trim();

    // Match URL (https:// or http://)
    const urlMatch = remainder.match(/(https?:\/\/[^\s]+)/);
    const url = urlMatch ? urlMatch[1] : undefined;
    if (urlMatch) remainder = remainder.replace(urlMatch[0], '').trim();

    // The rest is the author
    const author = remainder.trim() || undefined;

    return { id, title, author, year, url, raw: text };
}

/**
 * Extract text from a list item's paragraph content.
 */
function getListItemText(item: ListItem): string {
    let text = '';
    for (const child of item.children) {
        if (child.type === 'paragraph') {
            for (const inline of (child as Paragraph).children) {
                if (inline.type === 'text') {
                    text += (inline as Text).value;
                } else if (inline.type === 'link') {
                    // Include the URL from links, with space so parseReference can find it
                    const url = (inline as Link).url;
                    if (!text.endsWith(' ')) text += ' ';
                    text += url;
                }
            }
        }
    }
    return text;
}


export const remarkGlintCitations: Plugin<[], Root> = function () {
    return (tree: Root, file: VFile) => {
        const citationData: CitationData = {
            references: new Map(),
            citationOrder: []
        };

        // Pass 1: Find and parse the ## References section
        visit(tree, 'heading', (node: Heading, index, parent) => {
            if (!parent || index === undefined) return;
            if (node.depth !== 2) return;

            // Check if heading text is "References"
            const headingText = node.children
                .filter((c): c is Text => c.type === 'text')
                .map(c => c.value)
                .join('')
                .trim();

            if (headingText.toLowerCase() !== 'references') return;

            // Look for the next sibling which should be a list
            const nextSibling = parent.children[index + 1];
            if (!nextSibling || nextSibling.type !== 'list') return;

            const list = nextSibling as List;
            for (const item of list.children) {
                if (item.type !== 'listItem') continue;
                const text = getListItemText(item as ListItem);
                const ref = parseReference(text);
                if (ref) {
                    citationData.references.set(ref.id, ref);
                }
            }
        });

        // Pass 2: Transform inline citations [[#ref:id]]
        visit(tree, 'text', (node: Text, index, parent) => {
            if (!parent || index === undefined) return;

            const value = node.value;
            // Match [[#ref:id]]
            const regex = /\[\[#ref:([^\]]+)\]\]/g;

            let match;
            const newNodes: PhrasingContent[] = [];
            let lastIndex = 0;

            while ((match = regex.exec(value)) !== null) {
                // Text before the match
                if (match.index > lastIndex) {
                    newNodes.push({
                        type: 'text',
                        value: value.slice(lastIndex, match.index)
                    });
                }

                const refId = match[1].trim();

                // Track citation order for numbering
                if (!citationData.citationOrder.includes(refId)) {
                    citationData.citationOrder.push(refId);
                }
                const citationNumber = citationData.citationOrder.indexOf(refId) + 1;

                // Create an HTML node for the citation
                // This will be processed by rehype-raw
                newNodes.push({
                    type: 'html',
                    value: `<cite class="glint-cite" data-ref="${refId}">[${citationNumber}]</cite>`
                } as any);

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

        // Store citation data for later use by rehype
        file.data.citations = citationData;
    };
};

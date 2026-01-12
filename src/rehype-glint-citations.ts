/**
 * Rehype plugin to render Glint citations and bibliographies.
 * 
 * - Attaches hover card data to <cite> elements.
 * - Transforms the ## References section into a styled bibliography.
 */

import { visit } from 'unist-util-visit';
import type { Plugin } from 'unified';
import type { Root, Element, Text } from 'hast';
import type { VFile } from 'vfile';
import type { CitationData, Reference } from './remark-glint-citations.js';

/**
 * Create a hover card element for a reference.
 */
function createHoverCard(ref: Reference): Element {
    const children: (Element | Text)[] = [];

    // Title
    children.push({
        type: 'element',
        tagName: 'strong',
        properties: { className: ['cite-title'] },
        children: [{ type: 'text', value: ref.title }]
    });

    // Author and year
    if (ref.author || ref.year) {
        const meta: string[] = [];
        if (ref.author) meta.push(ref.author);
        if (ref.year) meta.push(`(${ref.year})`);
        children.push({
            type: 'element',
            tagName: 'div',
            properties: { className: ['cite-meta'] },
            children: [{ type: 'text', value: meta.join(' ') }]
        });
    }

    // URL
    if (ref.url) {
        children.push({
            type: 'element',
            tagName: 'a',
            properties: { className: ['cite-url'], href: ref.url, target: '_blank', rel: 'noopener' },
            children: [{ type: 'text', value: ref.url }]
        });
    }

    return {
        type: 'element',
        tagName: 'div',
        properties: { className: ['glint-cite-card'], 'data-ref': ref.id },
        children
    };
}

export const rehypeGlintCitations: Plugin<[], Root> = function () {
    return (tree: Root, file: VFile) => {
        const citationData = file.data.citations as CitationData | undefined;
        if (!citationData) return;

        const hoverCards: Element[] = [];

        // Pass 1: Enhance <cite> elements with tooltip triggers
        visit(tree, 'element', (node: Element) => {
            if (node.tagName !== 'cite') return;
            const classNames = node.properties?.className;
            if (!Array.isArray(classNames) || !classNames.includes('glint-cite')) return;

            const refId = node.properties['dataRef'] as string;
            if (!refId) return;

            const ref = citationData.references.get(refId);
            if (ref) {
                // Add href to scroll to bibliography entry
                const citeNumber = citationData.citationOrder.indexOf(refId) + 1;
                node.properties['data-cite-num'] = citeNumber;
                node.properties['aria-label'] = ref.title;
                node.properties['tabIndex'] = 0;

                // Collect hover card
                hoverCards.push(createHoverCard(ref));
            }
        });

        // Pass 2: Transform the References section into a styled bibliography
        visit(tree, 'element', (node: Element, index, parent) => {
            if (!parent || index === undefined) return;
            if (node.tagName !== 'h2') return;

            // Check if this is the "References" heading
            const textContent = node.children
                .filter((c): c is Text => c.type === 'text')
                .map(c => c.value)
                .join('')
                .trim();

            if (textContent.toLowerCase() !== 'references') return;

            // Find the next sibling <ul>
            const nextSibling = parent.children[index + 1] as Element | undefined;
            if (!nextSibling || nextSibling.tagName !== 'ul') return;

            // Transform the <ul> into a styled bibliography
            nextSibling.properties = { className: ['glint-bibliography'] };
            nextSibling.tagName = 'ol';

            // Transform each <li> into a reference entry
            for (const li of nextSibling.children) {
                if ((li as Element).type !== 'element' || (li as Element).tagName !== 'li') continue;
                const liEl = li as Element;

                // Try to extract ref id from text
                const liText = liEl.children
                    .flatMap((c: any) => c.type === 'element' && c.tagName === 'p' ? c.children : [c])
                    .filter((c: any) => c.type === 'text')
                    .map((c: any) => c.value)
                    .join('');

                const idMatch = liText.match(/\[ref:([^\]]+)\]/);
                if (idMatch) {
                    const refId = idMatch[1].trim();
                    const ref = citationData.references.get(refId);
                    if (ref) {
                        liEl.properties = {
                            className: ['glint-bib-entry'],
                            id: `ref-${refId}`,
                            'data-ref': refId
                        };

                        // Rebuild the li content with structured elements
                        liEl.children = [
                            {
                                type: 'element',
                                tagName: 'span',
                                properties: { className: ['bib-title'] },
                                children: [{ type: 'text', value: ref.title }]
                            } as Element,
                            ...(ref.author ? [{
                                type: 'element',
                                tagName: 'span',
                                properties: { className: ['bib-author'] },
                                children: [{ type: 'text', value: ` ${ref.author}` }]
                            } as Element] : []),
                            ...(ref.year ? [{
                                type: 'element',
                                tagName: 'span',
                                properties: { className: ['bib-year'] },
                                children: [{ type: 'text', value: ` (${ref.year})` }]
                            } as Element] : []),
                            ...(ref.url ? [{
                                type: 'element',
                                tagName: 'a',
                                properties: { className: ['bib-url'], href: ref.url, target: '_blank', rel: 'noopener' },
                                children: [{ type: 'text', value: ref.url }]
                            } as Element] : [])
                        ];
                    }
                }
            }
        });

        // Inject hover cards container at the end of the document
        if (hoverCards.length > 0) {
            const container: Element = {
                type: 'element',
                tagName: 'div',
                properties: { className: ['glint-cite-cards'], 'aria-hidden': 'true' },
                children: hoverCards
            };
            tree.children.push(container);
        }
    };
};

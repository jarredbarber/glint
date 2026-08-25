/**
 * REHYPE GLINT SECTIONS PLUGIN
 * 
 * PURPOSE:
 * Wraps top-level HAST nodes into hierarchical <section> tags based on heading levels (H2-H6).
 * This enables:
 * 1. Sticky headings (headings are sticky within their section container)
 * 2. Visual grouping of related content
 * 3. Future features like collapsible sections and section-based reordering
 */

import { Root, Element, Content } from 'hast';

export function rehypeGlintSections() {
    return (tree: Root) => {
        const newChildren: Content[] = [];
        const stack: { level: number; section: Element }[] = [];
        // Everything before the first H2 (frontmatter title, leading prose) is collected
        // here and wrapped in a headingless section so the editor can open it (#67). A
        // preamble section carries NO data-section-line, so getSectionRange treats it as
        // the "lines 1..firstHeading" range.
        let preamble: Content[] = [];
        let sawSection = false;
        const flushPreamble = () => {
            if (!preamble.length) return;
            newChildren.push({
                type: 'element', tagName: 'section',
                properties: { className: ['glint-section', 'level-1', 'glint-preamble'] },
                children: preamble as Element['children'],
            } as Element);
            preamble = [];
        };

        function getLevel(tagName: string): number {
            if (tagName === 'h1') return 1;
            if (tagName === 'h2') return 2;
            if (tagName === 'h3') return 3;
            if (tagName === 'h4') return 4;
            if (tagName === 'h5') return 5;
            if (tagName === 'h6') return 6;
            return 0;
        }

        function createSection(heading?: Element): Element {
            const level = heading ? getLevel(heading.tagName) : 0;
            const properties: any = {
                className: ['glint-section', `level-${level}`]
            };

            if (heading?.properties?.['data-source-line']) {
                properties['data-section-line'] = heading.properties['data-source-line'];
            }

            return {
                type: 'element',
                tagName: 'section',
                properties,
                children: heading ? [heading] : []
            };
        }

        // Top-level output before any section: buffer into preamble; after: newChildren.
        const emitTop = (node: Content) => (sawSection ? newChildren : preamble).push(node);

        for (const child of tree.children) {
            // Filter out doctype and handle types to satisfy ElementContent
            if (child.type === 'doctype') continue;

            // At this point child is Text | Comment | Element | Raw (collectively ElementContent)
            const node = child as any;

            if (node.type !== 'element') {
                if (stack.length > 0) {
                    stack[stack.length - 1].section.children.push(node);
                } else {
                    emitTop(node);
                }
                continue;
            }

            const element = node as Element;
            const level = getLevel(element.tagName);

            if (level === 0 || level === 1) {
                if (stack.length > 0) {
                    stack[stack.length - 1].section.children.push(element);
                } else {
                    emitTop(element);
                }
                continue;
            }

            // First H2+ heading: close out the preamble before opening real sections.
            if (!sawSection) { flushPreamble(); sawSection = true; }

            while (stack.length > 0 && stack[stack.length - 1].level >= level) {
                stack.pop();
            }

            const newSection = createSection(element);
            const entry = { level, section: newSection };

            if (stack.length > 0) {
                stack[stack.length - 1].section.children.push(newSection);
            } else {
                newChildren.push(newSection);
            }

            stack.push(entry);
        }

        // A document with no H2+ heading: wrap the whole thing so it stays editable (#67).
        flushPreamble();
        tree.children = newChildren;
    };
}

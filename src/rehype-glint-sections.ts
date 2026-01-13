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

        for (const child of tree.children) {
            // Filter out doctype and handle types to satisfy ElementContent
            if (child.type === 'doctype') continue;

            // At this point child is Text | Comment | Element | Raw (collectively ElementContent)
            const node = child as any;

            if (node.type !== 'element') {
                if (stack.length > 0) {
                    stack[stack.length - 1].section.children.push(node);
                } else {
                    newChildren.push(node);
                }
                continue;
            }

            const element = node as Element;
            const level = getLevel(element.tagName);

            if (level === 0 || level === 1) {
                if (stack.length > 0) {
                    stack[stack.length - 1].section.children.push(element);
                } else {
                    newChildren.push(element);
                }
                continue;
            }

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

        tree.children = newChildren;
    };
}

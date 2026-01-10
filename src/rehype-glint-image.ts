import { visit } from 'unist-util-visit';
import { Root, Element, Text, Content } from 'hast';

/**
 * A rehype plugin that handles Glint-specific image logic:
 * 1. Wraps images with alt text in <figure> and <figcaption>.
 * 2. Parses images inside 'raw' strings (common after a resize) if possible.
 */
export function rehypeGlintImage() {
    return (tree: Root) => {
        visit(tree, ['element', 'raw'], (node: any, index, parent: any) => {
            // Case 1: Standard Element
            if (node.type === 'element' && node.tagName === 'img') {
                handleImageElement(node, index, parent);
            }
            // Case 2: Raw HTML (from a previous resize/save)
            else if (node.type === 'raw' && node.value.includes('<img')) {
                // If it's a simple <img> tag, we can attempt to parse it or just wrap it if we can find the alt text
                const imgMatch = node.value.match(/<img[^>]*src=["']([^"']*)["'][^>]*alt=["']([^"']*)["'][^>]*>/i) ||
                    node.value.match(/<img[^>]*alt=["']([^"']*)["'][^>]*src=["']([^"']*)["'][^>]*>/i);

                if (imgMatch) {
                    const altText = (imgMatch[1].includes('/') ? imgMatch[2] : imgMatch[1]).trim();
                    if (altText) {
                        // Transform the raw node into a figure element
                        // This is tricky because rehype-stringify will just output the value if we don't change type

                        // Let's replace the raw node with a proper element structure
                        // We need to parse the raw string into props
                        const props: any = {};
                        const widthMatch = node.value.match(/width=["']([^"']*)["']/i);
                        const srcMatch = node.value.match(/src=["']([^"']*)["']/i);
                        const altMatch = node.value.match(/alt=["']([^"']*)["']/i);
                        const lineMatch = node.value.match(/data-source-line=["']([^"']*)["']/i);

                        if (srcMatch) props.src = srcMatch[1];
                        if (altMatch) props.alt = altMatch[1];
                        if (widthMatch) props.width = widthMatch[1];
                        if (lineMatch) props['data-source-line'] = lineMatch[1];

                        const imgElement: Element = {
                            type: 'element',
                            tagName: 'img',
                            properties: props,
                            children: []
                        };

                        const figure = createFigure(imgElement, altText);
                        if (parent && index !== undefined) {
                            parent.children[index] = figure;
                        }
                    }
                }
            }
        });
    };
}

function handleImageElement(node: Element, index: number | undefined, parent: any) {
    if (node.properties?.alt) {
        const altText = String(node.properties.alt).trim();
        if (altText) {
            const figure = createFigure(node, altText);
            if (parent && index !== undefined) {
                parent.children[index] = figure;
            }
        }
    }
}

function createFigure(imgNode: Element, altText: string): Element {
    const figcaption: Element = {
        type: 'element',
        tagName: 'figcaption',
        properties: { className: ['image-caption'] },
        children: [{ type: 'text', value: altText } as Text]
    };

    return {
        type: 'element',
        tagName: 'figure',
        properties: {
            className: ['image-figure'],
            // Inherit source line if already added
            'data-source-line': imgNode.properties?.['data-source-line']
        },
        children: [
            { ...imgNode },
            figcaption
        ],
        position: imgNode.position
    };
}

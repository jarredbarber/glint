import { visit } from 'unist-util-visit';
import { Root, Element, Text } from 'hast';

/**
 * ============================================================================
 * REHYPE GLINT IMAGE PLUGIN
 * ============================================================================
 * 
 * PURPOSE:
 * Handles Glint's image rendering, including:
 * 1. Width syntax: ![alt|width](url) → applies width attribute
 * 2. Figure/caption: Images with alt text get wrapped in <figure>/<figcaption>
 * 3. Legacy HTML images: <img> tags from old resizes still work
 * 
 * WIDTH SYNTAX:
 *   ![My Photo|500](image.png)    → width="500" (pixels)
 *   ![My Photo|50%](image.png)    → width="50%"  
 *   ![My Photo](image.png)        → no width (natural size)
 * 
 * The alt text displayed is everything before the |, so "My Photo" shows
 * as the caption, not "My Photo|500".
 * 
 * ============================================================================
 */
export function rehypeGlintImage() {
    return (tree: Root, file: any) => {
        const filePath = file.data.filePath;
        const shareId = file.data.shareId;

        visit(tree, ['element', 'raw'], (node: any, index, parent: any) => {
            // Case 1: Standard <img> element from markdown
            if (node.type === 'element' && node.tagName === 'img') {
                handleImageElement(node, index, parent, filePath, shareId);
            }
            // Case 2: Raw HTML <img> (legacy from old resize saves)
            else if (node.type === 'raw' && node.value.includes('<img')) {
                handleRawImageHtml(node, index, parent, filePath, shareId);
            }
        });
    };
}

/**
 * Handle standard <img> elements.
 * Parses alt text for |width syntax and wraps in figure if alt text exists.
 */
function handleImageElement(node: Element, index: number | undefined, parent: any, filePath?: string, shareId?: string) {
    const rawAlt = node.properties?.alt ? String(node.properties.alt) : '';

    // Parse width from alt text: "Caption|500" → { caption: "Caption", width: "500" }
    const { caption, width } = parseAltWithWidth(rawAlt);

    // Apply width if specified
    if (width) {
        node.properties = node.properties || {};
        node.properties.width = width;
    }

    // Update alt to be just the caption (without width)
    if (node.properties) {
        node.properties.alt = caption;

        // Rewrite SRC to use resolver API
        if (node.properties.src && typeof node.properties.src === 'string') {
            const originalSrc = node.properties.src;
            node.properties['data-glint-src'] = originalSrc;
            node.properties.src = resolveImageUrl(originalSrc, filePath, shareId);
        }
    }

    // Wrap in figure if there's a caption
    if (caption.trim()) {
        const figure = createFigure(node, caption.trim());
        if (parent && index !== undefined) {
            parent.children[index] = figure;
        }
    }
}

/**
 * Handle raw HTML <img> tags (legacy support for old resized images).
 */
function handleRawImageHtml(node: any, index: number | undefined, parent: any, filePath?: string, shareId?: string) {
    const imgMatch = node.value.match(/<img[^>]*src=["']([^"']*)["'][^>]*alt=["']([^"']*)["'][^>]*>/i) ||
        node.value.match(/<img[^>]*alt=["']([^"']*)["'][^>]*src=["']([^"']*)["'][^>]*>/i);

    if (imgMatch) {
        const altText = (imgMatch[1].includes('/') ? imgMatch[2] : imgMatch[1]).trim();
        if (altText) {
            const props: any = {};
            const widthMatch = node.value.match(/width=["']([^"']*)["']/i);
            const srcMatch = node.value.match(/src=["']([^"']*)["']/i);
            const altMatch = node.value.match(/alt=["']([^"']*)["']/i);
            const lineMatch = node.value.match(/data-source-line=["']([^"']*)["']/i);

            if (srcMatch) {
                const originalSrc = srcMatch[1];
                props['data-glint-src'] = originalSrc;
                props.src = resolveImageUrl(originalSrc, filePath, shareId);
            }
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

/**
 * Resolves an image URL to a robust API endpoint.
 */
function resolveImageUrl(src: string, filePath?: string, shareId?: string): string {
    // Skip external URLs
    if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('//') || src.startsWith('data:')) {
        return src;
    }

    // If it's already an API call, skip
    if (src.startsWith('/api/asset/')) {
        return src;
    }

    // Create resolver URL
    const params = new URLSearchParams();
    params.set('path', src);
    if (filePath) {
        params.set('context', filePath);
    }
    if (shareId) {
        params.set('shareId', shareId);
    }

    return `/api/asset/resolve?${params.toString()}`;
}

/**
 * Parse alt text that may contain a width specification.
 * Format: "Caption|width" where width is pixels (500) or percentage (50%)
 */
function parseAltWithWidth(alt: string): { caption: string; width: string | null } {
    // Look for pattern: text|width where width is digits optionally followed by %
    const match = alt.match(/^(.+?)\|(\d+%?)$/);
    if (match) {
        return { caption: match[1], width: match[2] };
    }
    return { caption: alt, width: null };
}

/**
 * Create a <figure> element wrapping an image with a caption.
 */
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
            'data-source-line': imgNode.properties?.['data-source-line']
        },
        children: [
            { ...imgNode },
            figcaption
        ],
        position: imgNode.position
    };
}

/**
 * ============================================================================
 * REHYPE SOURCE LINES PLUGIN
 * ============================================================================
 * 
 * PURPOSE:
 * This rehype plugin adds `data-source-line` attributes to HTML elements,
 * mapping each element back to its line number in the ORIGINAL markdown source.
 * 
 * HOW IT WORKS:
 * Since all transforms are now LINE-PRESERVING (or close to it), we just need a simple offset
 * for frontmatter/H1 stripping. The formula is:
 * 
 *   originalLine = processedLine + contentStartLine - 1
 * 
 * CRITICAL DEPENDENCY:
 * The inline section editor (editor-integration.ts) uses these attributes to:
 * 1. Determine which DOM elements belong to a section being edited
 * 2. Hide the correct elements when the editor opens
 * 3. Extract the correct source lines for editing
 * 
 * ============================================================================
 */

import { visit } from 'unist-util-visit';
import { Root, Element } from 'hast';
import { VFile } from 'vfile';

export function rehypeSourceLines() {
    return (tree: Root, file: VFile) => {
        // Simple offset: how many lines were stripped (frontmatter + H1)
        const contentStartLine = (file.data.contentStartLine as number) || 1;
        const offset = contentStartLine - 1;

        visit(tree, 'element', (node: Element) => {
            // Skip header anchor links (they don't correspond to source content)
            if (node.tagName === 'span' && node.properties?.className === 'header-anchor') return;

            // Skip elements that already have data-source-line (set by widget transforms)
            if (node.properties?.['dataSourceLine'] || node.properties?.['data-source-line']) return;

            if (node.position?.start) {
                if (!node.properties) node.properties = {};

                const processedLine = node.position.start.line;
                const originalLine = processedLine + offset;

                node.properties['data-source-line'] = originalLine;
            }
        });
    };
}

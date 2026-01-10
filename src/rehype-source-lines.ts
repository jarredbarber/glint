/**
 * ============================================================================
 * REHYPE SOURCE LINES PLUGIN
 * ============================================================================
 * 
 * PURPOSE:
 * This rehype plugin adds `data-source-line` attributes to HTML elements,
 * mapping each element back to its line number in the ORIGINAL markdown source.
 * 
 * CRITICAL DEPENDENCY:
 * The inline section editor (editor-integration.ts) uses these attributes to:
 * 1. Determine which DOM elements belong to a section being edited
 * 2. Hide the correct elements when the editor opens
 * 3. Extract the correct source lines for editing
 * 
 * If this plugin produces incorrect line numbers, the editor will show/edit
 * the wrong content!
 * 
 * PLUGIN ORDER MATTERS:
 * This plugin MUST run BEFORE rehype-katex, rehype-highlight, and other
 * transforming plugins. Those plugins replace nodes with new structures that
 * lose the original position information. By running first, we capture the
 * position info while it's still available.
 * 
 * ============================================================================
 */

import { visit } from 'unist-util-visit';
import { Root, Element } from 'hast';
import { VFile } from 'vfile';
import { SourceMap } from './source-map.js';

export function rehypeSourceLines() {
    return (tree: Root, file: VFile) => {
        // Support both new SourceMap and legacy lineMapping
        const sourceMap = file.data.sourceMap as SourceMap | undefined;
        const legacyOffset = (file.data.contentStartLine as number) || 1;

        visit(tree, 'element', (node: Element) => {
            // Skip header anchor links (they don't correspond to source content)
            if (node.tagName === 'span' && node.properties?.className === 'header-anchor') return;

            if (node.position?.start) {
                if (!node.properties) node.properties = {};

                const processedLine = node.position.start.line;
                let sourceLine: number;

                if (sourceMap) {
                    // New SourceMap-based lookup (preferred)
                    sourceLine = sourceMap.getSourceLine(processedLine);
                } else {
                    // Fallback to simple offset if no map provided
                    sourceLine = processedLine + legacyOffset - 1;
                }

                node.properties['data-source-line'] = sourceLine;
            }
        });
    };
}


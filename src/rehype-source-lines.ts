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
 * Current order in server.ts (as of 2025-01-10):
 *   remark-rehype → rehypeSourceLines → rehypeGlintImage → rehypeKatex → ...
 * 
 * LINE NUMBER CALCULATION:
 * The final source line = mapping(processedLine) + frontmatterOffset - 1
 * 
 * Where:
 * - processedLine: node.position.start.line from the HAST node
 * - mapping: processedToSource map from remark-glint-math.ts (if available)
 * - frontmatterOffset: contentStartLine from markdown.ts (accounts for YAML)
 * 
 * ============================================================================
 */

import { visit } from 'unist-util-visit';
import { Root, Element } from 'hast';
import { VFile } from 'vfile';
import { LineMapping } from './remark-glint-math.js';

export function rehypeSourceLines() {
    return (tree: Root, file: VFile) => {
        // Frontmatter offset: if the markdown has YAML frontmatter or an H1 title
        // that was stripped, contentStartLine tells us where actual content begins
        const offset = (file.data.contentStartLine as number) || 1;

        // Line mapping from preprocessing (handles $$$ and single-line $$ conversions)
        const lineMapping = file.data.lineMapping as LineMapping | undefined;

        visit(tree, 'element', (node: Element) => {
            // Skip header anchor links (they don't correspond to source content)
            if (node.tagName === 'span' && node.properties?.className === 'header-anchor') return;

            if (node.position && node.position.start) {
                if (!node.properties) node.properties = {};

                // Step 1: Get the line in the PROCESSED content
                const processedLine = node.position.start.line;

                // Step 2: Map back to SOURCE line (before preprocessing)
                let sourceLine: number;
                if (lineMapping && lineMapping.processedToSource.has(processedLine)) {
                    sourceLine = lineMapping.processedToSource.get(processedLine)!;
                } else {
                    sourceLine = processedLine;
                }

                // Step 3: Apply frontmatter offset to get final source line
                node.properties['data-source-line'] = sourceLine + offset - 1;
            }
        });
    };
}

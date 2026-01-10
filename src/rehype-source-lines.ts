import { visit } from 'unist-util-visit';
import { Root, Element } from 'hast';
import { VFile } from 'vfile';
import { LineMapping } from './remark-glint-math.js';

/**
 * A rehype plugin that adds `data-source-line` attributes to HTML elements
 * based on their position in the original markdown source.
 */
export function rehypeSourceLines() {
    return (tree: Root, file: VFile) => {
        // Get offset from file data or default to 1
        const offset = (file.data.contentStartLine as number) || 1;
        // Get line mapping if available
        const lineMapping = file.data.lineMapping as LineMapping | undefined;

        visit(tree, 'element', (node: Element) => {
            // Skip certain elements that shouldn't have line numbers
            if (node.tagName === 'span' && node.properties?.className === 'header-anchor') return;

            if (node.position && node.position.start) {
                if (!node.properties) node.properties = {};

                // Get the line in the processed content
                const processedLine = node.position.start.line;

                // Map back to source line if mapping available
                let sourceLine: number;
                if (lineMapping && lineMapping.processedToSource.has(processedLine)) {
                    sourceLine = lineMapping.processedToSource.get(processedLine)!;
                } else {
                    sourceLine = processedLine;
                }

                // Apply frontmatter offset
                node.properties['data-source-line'] = sourceLine + offset - 1;
            }
        });
    };
}

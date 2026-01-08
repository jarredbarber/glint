import type { Plugin } from 'unified';
import type { Root, Element } from 'hast';
import { visit } from 'unist-util-visit';
import { toText } from 'hast-util-to-text';

/**
 * Rehype plugin to handle equation numbering markers.
 * 
 * Runs after remark-rehype (which converts math nodes to span.math-display)
 * and before rehype-katex.
 * 
 * - Detects %GLINT_NO_NUMBER% in text content
 * - Removes it
 * - Adds .no-number class
 */
export const rehypeMathEnumerate: Plugin<[], Root> = function () {
    return (tree: Root) => {
        visit(tree, 'element', (node: Element) => {
            // Check for math styling classes that remark-rehype/remark-math produce
            // Usually 'math-display' or 'math-inline'
            const classes = Array.isArray(node.properties?.className)
                ? node.properties.className
                : [];

            if (classes.includes('math') || classes.includes('math-display')) {
                // Get text content
                const text = toText(node);

                if (text.includes('%GLINT_NO_NUMBER%')) {
                    // We need to modify the children text node directly
                    // Usually math elements have a single text child
                    if (node.children.length > 0 && node.children[0].type === 'text') {
                        node.children[0].value = node.children[0].value.replace('%GLINT_NO_NUMBER%', '').trim();
                    }

                    // Add no-number class
                    if (!node.properties) node.properties = {};
                    const currentClasses = (node.properties.className as string[]) || [];
                    node.properties.className = [...currentClasses, 'no-number'];
                }
            }
        });
    };
};

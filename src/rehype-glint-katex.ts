import { visit } from 'unist-util-visit';
import { Root, Element, Text } from 'hast';
import katex from 'katex';

/**
 * ============================================================================
 * REHYPE GLINT KATEX
 * ============================================================================
 *
 * A rehype plugin to render math elements produced by remark-math.
 *
 * remark-math creates <code class="language-math math-inline"> and
 * <code class="language-math math-display"> elements within <span> or <div>.
 *
 * This plugin finds those elements and renders them with KaTeX.
 *
 * ============================================================================
 */

export function rehypeGlintKatex(options: any = {}) {
    const macros = options.macros || {};
    const katexOpts = {
        throwOnError: false,
        trust: true,
        macros,
        strict: false
    };

    return (tree: Root) => {
        visit(tree, 'element', (node: Element, index, parent) => {
            if (!parent || index === undefined) return;

            // remark-math + remark-rehype produces:
            // Inline: <span class="math math-inline"><span class="katex">...</span></span>
            // Display: <div class="math math-display"><span class="katex">...</span></div>
            //
            // OR with newer versions:
            // <code class="language-math math-inline">...</code>
            // <code class="language-math math-display">...</code>
            //
            // We need to handle both cases.

            const classes = getClasses(node);

            // Check for math-inline or math-display class
            const isInline = classes.includes('math-inline');
            const isDisplay = classes.includes('math-display');

            if (!isInline && !isDisplay) return;

            // Extract the LaTeX content
            const mathContent = extractText(node);
            if (!mathContent) return;

            // Render with KaTeX
            try {
                const rendered = katex.renderToString(mathContent, {
                    ...katexOpts,
                    displayMode: isDisplay
                });

                // Replace the node with rendered HTML
                const wrapper: Element = {
                    type: 'element',
                    tagName: isDisplay ? 'span' : 'span',
                    properties: {
                        className: isDisplay ? ['katex-display'] : ['katex']
                    },
                    children: [{ type: 'raw' as any, value: rendered }]
                };

                (parent as any).children[index] = wrapper;
            } catch (e: any) {
                // Render error
                const errorNode: Element = {
                    type: 'element',
                    tagName: 'span',
                    properties: { className: ['katex-error'], style: 'color: red' },
                    children: [{ type: 'text', value: `Math Error: ${e.message}` }]
                };
                (parent as any).children[index] = errorNode;
            }
        });
    };
}

/**
 * Get class list from element properties
 */
function getClasses(node: Element): string[] {
    const className = node.properties?.className;
    if (!className) return [];
    if (Array.isArray(className)) return className.map(String);
    if (typeof className === 'string') return className.split(/\s+/);
    return [];
}

/**
 * Extract text content from an element and its children
 */
function extractText(node: Element): string {
    let text = '';

    function walk(n: any) {
        if (n.type === 'text') {
            text += n.value;
        } else if (n.children) {
            for (const child of n.children) {
                walk(child);
            }
        }
    }

    walk(node);
    return text.trim();
}

import { visit } from 'unist-util-visit';
import { Root, Element, Text } from 'hast';
import katex from 'katex';

/**
 * ============================================================================
 * REHYPE GLINT KATEX
 * ============================================================================
 *
 * A unified plugin to handle all math rendering in Glint.
 * Replaces: remark-math, rehype-katex, remark-glint-math
 *
 * FEATURES:
 * 1. Text-based detection: Scans text nodes for math delimiters
 * 2. Context-aware: Skips <pre>, <code>, <script>, <style>
 * 3. Supports Glint syntax:
 *    - $$$ ... $$$ -> align* environment
 *    - $$ ... $$ -> display math
 *    - $ ... $ -> inline math
 *
 * ============================================================================
 */

// Tags to skip content within
const SKIP_TAGS = ['pre', 'code', 'script', 'style', 'textarea'];

export function rehypeGlintKatex(options: any = {}) {
    // KaTeX options
    const macros = options.macros || {};
    const katexOpts = {
        throwOnError: false,
        trust: true,
        macros,
        strict: false
    };

    return (tree: Root) => {
        visit(tree, 'element', (node) => {
            if (SKIP_TAGS.includes(node.tagName)) {
                return 'skip';
            }
        });

        visit(tree, 'text', (node, index, parent) => {
            if (!parent || index === undefined || index === null) return;
            if (parent.type === 'element' && SKIP_TAGS.includes((parent as Element).tagName)) {
                return;
            }

            const value = node.value;

            if (!value.includes('$')) return;

            const nodes = processText(value, katexOpts);

            if (nodes.length > 0 && (nodes.length !== 1 || nodes[0].type !== 'text')) {
                (parent as any).children.splice(index, 1, ...nodes);
                return index + nodes.length;
            }
        });
    };
}

function processText(text: string, options: any): (Element | Text)[] {
    const result: (Element | Text)[] = [];

    // We basically need a simple parser loop.
    // Regex splitting is tricky because of escaping and nested $ inside text.
    // Let's iterate.

    let lastIndex = 0;

    // Helper to find closing delimiter
    const findClosing = (str: string, start: number, delim: string): number => {
        let i = start;
        while (i < str.length) {
            const idx = str.indexOf(delim, i);
            if (idx === -1) return -1;
            // Check for escape: \$
            if (str[idx - 1] === '\\') {
                i = idx + 1;
                continue;
            }
            return idx;
        }
        return -1;
    };

    let i = 0;
    while (i < text.length) {
        // Find next delimiter start
        const dollarIdx = text.indexOf('$', i);
        if (dollarIdx === -1) {
            // No more math
            result.push({ type: 'text', value: text.slice(i) });
            break;
        }

        // Check for escaped dollar
        if (dollarIdx > 0 && text[dollarIdx - 1] === '\\') {
            // It's just text, continue
            i = dollarIdx + 1;
            continue;
        }

        // Determine delimiter type
        let delim = '$';
        let isDisplay = false;
        let isAlign = false;

        if (text.startsWith('$$$', dollarIdx)) {
            delim = '$$$';
            isDisplay = true;
            isAlign = true;
        } else if (text.startsWith('$$', dollarIdx)) {
            delim = '$$';
            isDisplay = true;
        }

        const contentStart = dollarIdx + delim.length;
        const closeIdx = findClosing(text, contentStart, delim);

        if (closeIdx === -1) {
            // Unclosed math, treat as text
            i = dollarIdx + 1; // Advance past this dollar
            continue;
        }

        // We have a match!

        // 1. Push preceding text
        if (dollarIdx > lastIndex) {
            result.push({ type: 'text', value: text.slice(lastIndex, dollarIdx) });
        }

        // 2. Extract math content
        let mathContent = text.slice(contentStart, closeIdx);

        // 3. Render
        try {
            let rendered = '';
            let finalOptions = { ...options, displayMode: isDisplay };

            if (isAlign) {
                // Wrap in aligned environment
                mathContent = `\\begin{align*}${mathContent}\\end{align*}`;
            }

            rendered = katex.renderToString(mathContent, finalOptions);

            result.push({ type: 'raw' as any, value: rendered } as any);

        } catch (e: any) {
            // Render error as text in red or plain
            result.push({
                type: 'element',
                tagName: 'span',
                properties: { style: 'color: red' },
                children: [{ type: 'text', value: `Math Error: ${e.message}` }]
            });
        }

        lastIndex = closeIdx + delim.length;
        i = lastIndex;
    }

    // Trailing text
    if (lastIndex < text.length) {
        result.push({ type: 'text', value: text.slice(lastIndex) });
    }

    return result;
}

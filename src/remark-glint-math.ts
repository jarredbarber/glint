/**
 * Preprocessor for extended math syntax:
 * - $$$ ... $$$ → align environment
 * - $$$* ... $$$ → align* environment (no equation numbers)
 * - $$* ... $$ → display math (auto block-level, NO NUMBER)
 * - $$ ... $$ → display math (auto block-level, NUMBERED)
 * 
 * Uses tokens to preserve blocks.
 * FIX: Injects \htmlClass{no-number}{} to suppress numbering via CSS :has() selector.
 */

export function preprocessGlintMath(markdown: string): string {
    const blocks: string[] = [];

    const pushBlock = (text: string) => {
        const id = `__GLINT_MATH_BLOCK_${blocks.length}__`;
        blocks.push(text);
        return id;
    };

    // 1. Handle $$$ ... $$$ (Align environments)
    markdown = markdown.replace(
        /\$\$\$(\*?)\n([\s\S]*?)\n\$\$\$/g,
        (_match, star, content) => {
            const env = star === '*' ? 'align*' : 'align';
            const latex = `\\begin{${env}}\n${content}\n\\end{${env}}`;

            if (star === '*') {
                // Inject marker class for CSS detection
                return pushBlock(`\\htmlClass{no-number}{}\n${latex}`);
            }

            return pushBlock(latex);
        }
    );

    // 2. Handle $$* ... $$ (Display Math, explicit star -> NO NUMBER)
    markdown = markdown.replace(
        /\$\$\*\s*([\s\S]*?)\s*\$\$/g,
        (_match, content) => {
            return pushBlock(`\\htmlClass{no-number}{}\n${content.trim()}`);
        }
    );

    // 3. Handle $$ ... $$ (Standard Display Math -> NUMBERED)
    markdown = markdown.replace(
        /\$\$([\s\S]*?)\$\$/g,
        (_match, content) => {
            return pushBlock(content.trim());
        }
    );

    // 4. Restore blocks
    blocks.forEach((content, index) => {
        const id = `__GLINT_MATH_BLOCK_${index}__`;
        // Use callback to strictly preserve content including any $ characters
        markdown = markdown.replace(id, () => {
            return `\n\n$$\n${content}\n$$\n\n`;
        });
    });

    // 5. Cleanup
    markdown = markdown.replace(/\n{4,}/g, '\n\n');

    return markdown;
}

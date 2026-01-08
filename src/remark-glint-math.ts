/**
 * Preprocessor for extended math syntax:
 * - $$$ ... $$$ → align environment
 * - $$$* ... $$$ → align* environment (no equation numbers)
 * - $$* ... $$ → display math (auto block-level)
 * - $$ ... $$ → display math (auto block-level)
 * 
 * Uses a token replacement strategy.
 * FIX: Uses replacement functions to ensure $$ aren't interpreted as special chars.
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
            return pushBlock(latex);
        }
    );

    // 2. Handle $$* ... $$ (Display Math, explicit star)
    // We trim content to prevent extra newlines inside the block
    markdown = markdown.replace(
        /\$\$\*\s*([\s\S]*?)\s*\$\$/g,
        (_match, content) => {
            return pushBlock(content.trim());
        }
    );

    // 3. Handle $$ ... $$ (Standard Display Math)
    // Ensure we consume the surrounding $$ 
    markdown = markdown.replace(
        /\$\$([\s\S]*?)\$\$/g,
        (_match, content) => {
            return pushBlock(content.trim());
        }
    );

    // 4. Restore blocks wrapped in fencing newlines
    blocks.forEach((content, index) => {
        const id = `__GLINT_MATH_BLOCK_${index}__`;
        // Use a function for replacement to prevent $$ -> $ strings
        markdown = markdown.replace(id, () => {
            return `\n\n$$\n${content}\n$$\n\n`;
        });
    });

    // 5. Cleanup excessive newlines
    markdown = markdown.replace(/\n{4,}/g, '\n\n');

    return markdown;
}

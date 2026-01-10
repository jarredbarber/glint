/**
 * ============================================================================
 * GLINT MATH PREPROCESSOR
 * ============================================================================
 * 
 * PURPOSE:
 * This preprocessor runs BEFORE the unified markdown pipeline. It handles
 * Glint's extended math syntax and produces standard markdown that remark-math
 * can process.
 * 
 * CRITICAL INVARIANT:
 * This preprocessor MUST maintain accurate line mappings from processed content
 * back to original source. The inline section editor relies on these mappings
 * to correctly identify which source lines correspond to which DOM elements.
 * 
 * If you modify this file and break line mappings, the section editor will
 * show/edit the wrong content!
 * 
 * TRANSFORMATIONS:
 * 1. $$$ ... $$$ → $$\begin{align*}...\end{align*}$$ (multi-line alignment)
 * 2. $$ content $$ (single line) → $$\n content \n$$ (forces display mode)
 *    NOTE: remark-math treats single-line $$ as INLINE math. Only multi-line
 *    $$ blocks trigger display mode. This is a quirk of remark-math.
 * 
 * LINE MAPPING:
 * - processedToSource: Maps each line number in the processed output back
 *   to its corresponding line number in the original source markdown.
 * - When we expand 1 line to 3 lines (single-line $$ conversion), all 3
 *   processed lines map back to the original 1 source line.
 * - When we transform $$$ blocks, each processed line maps to its
 *   corresponding source line within the block.
 * 
 * ============================================================================
 */

export interface LineMapping {
    /** Maps processed line number (1-indexed) → original source line number (1-indexed) */
    processedToSource: Map<number, number>;
}

export interface PreprocessResult {
    content: string;
    lineMapping: LineMapping;
}

export function preprocessGlintMath(markdown: string): PreprocessResult {
    const originalLines = markdown.split('\n');
    const processedLines: string[] = [];
    const processedToSource = new Map<number, number>();

    let procLine = 1; // 1-indexed processed line counter

    for (let srcLine = 0; srcLine < originalLines.length; srcLine++) {
        const line = originalLines[srcLine];
        const srcLineNum = srcLine + 1; // Convert to 1-indexed

        // =========================================
        // CASE 1: $$$ block start (align environment)
        // =========================================
        if (line.trim() === '$$$') {
            // Find the matching closing $$$
            let endIdx = srcLine + 1;
            while (endIdx < originalLines.length && originalLines[endIdx].trim() !== '$$$') {
                endIdx++;
            }

            // Output: $$, \begin{align*}, content lines, \end{align*}, $$
            processedLines.push('$$');
            processedToSource.set(procLine++, srcLineNum);

            processedLines.push('\\begin{align*}');
            processedToSource.set(procLine++, srcLineNum);

            // Copy content lines with correct mapping
            for (let i = srcLine + 1; i < endIdx; i++) {
                processedLines.push(originalLines[i]);
                processedToSource.set(procLine++, i + 1); // Map to actual source line
            }

            processedLines.push('\\end{align*}');
            processedToSource.set(procLine++, endIdx + 1);

            processedLines.push('$$');
            processedToSource.set(procLine++, endIdx + 1);

            // Skip past the closing $$$
            srcLine = endIdx;
            continue;
        }

        // =========================================
        // CASE 2: Single-line $$ ... $$ (display math)
        // =========================================
        // remark-math ONLY treats $$ as display mode when it's multi-line.
        // Single-line $$ x = y $$ is treated as inline!
        // We convert it to multi-line to force display mode.
        const singleLineMatch = line.match(/^\$\$\s+(.+?)\s+\$\$$/);
        if (singleLineMatch) {
            // Convert 1 line to 3 lines, but ALL map back to same source line
            processedLines.push('$$');
            processedToSource.set(procLine++, srcLineNum);

            processedLines.push(singleLineMatch[1]);
            processedToSource.set(procLine++, srcLineNum);

            processedLines.push('$$');
            processedToSource.set(procLine++, srcLineNum);
            continue;
        }

        // =========================================
        // CASE 3: Normal line (1:1 mapping)
        // =========================================
        processedLines.push(line);
        processedToSource.set(procLine++, srcLineNum);
    }

    return {
        content: processedLines.join('\n'),
        lineMapping: { processedToSource }
    };
}

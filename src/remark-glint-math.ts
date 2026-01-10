/**
 * ============================================================================
 * GLINT MATH PREPROCESSOR
 * ============================================================================
 * 
 * PURPOSE:
 * This preprocessor handles Glint's extended math syntax and produces standard
 * markdown that remark-math can process.
 * 
 * TRANSFORMATIONS:
 * 1. $$$ ... $$$ → $$\begin{align*}...\end{align*}$$ (multi-line alignment)
 * 2. $$ content $$ (single line) → $$\n content \n$$ (forces display mode)
 *    NOTE: remark-math treats single-line $$ as INLINE math. Only multi-line
 *    $$ blocks trigger display mode. This is a quirk of remark-math.
 * 
 * LINE MAPPING:
 * Returns Edit[] compatible with SourceMap.transform() for accurate line
 * tracking back to the original source.
 * 
 * ============================================================================
 */

import { Edit, LineRange, TransformResult } from './source-map.js';

/**
 * Transform function for math preprocessing.
 * Compatible with SourceMap.transform().
 */
export function mathPreprocessor(content: string): TransformResult {
    const lines = content.split('\n');
    const outputLines: string[] = [];
    const edits: Edit[] = [];

    let inputLine = 1; // 1-indexed
    let outputLine = 1; // 1-indexed

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const currentInputLine = i + 1;

        // =========================================
        // CASE 1: $$$ block start (align environment)
        // =========================================
        if (line.trim() === '$$$') {
            // Find the matching closing $$$
            let endIdx = i + 1;
            while (endIdx < lines.length && lines[endIdx].trim() !== '$$$') {
                endIdx++;
            }

            // --- Edit 1: Opening tag ---
            // Input: Line i ($$$)
            // Output: $$ \n \begin{align*}
            const startInputLine = currentInputLine;
            const startOutputLine = outputLine;

            outputLines.push('$$');
            outputLines.push('\\begin{align*}');

            // Record edit for opening tag
            edits.push({
                inputRange: { start: startInputLine, end: startInputLine },
                outputRange: { start: startOutputLine, end: startOutputLine + 1 }
            });
            outputLine += 2;

            // --- Content (preserved, no edit needed, just copy) ---
            for (let j = i + 1; j < endIdx; j++) {
                outputLines.push(lines[j]);
                outputLine++;
            }

            // --- Edit 2: Closing tag ---
            // Input: Line endIdx ($$$)
            // Output: \end{align*} \n $$
            const endInputLine = endIdx + 1;
            const endOutputLine = outputLine;

            outputLines.push('\\end{align*}');
            outputLines.push('$$');

            // Record edit for closing tag
            edits.push({
                inputRange: { start: endInputLine, end: endInputLine },
                outputRange: { start: endOutputLine, end: endOutputLine + 1 }
            });
            outputLine += 2;

            i = endIdx; // Skip past the closing $$$
            continue;
        }

        // =========================================
        // CASE 2: Single-line $$ ... $$ (display math)
        // =========================================
        const singleLineMatch = line.match(/^\$\$\s+(.+?)\s+\$\$$/);
        if (singleLineMatch) {
            const outputStart = outputLine;

            // Convert 1 line to 3 lines
            outputLines.push('$$');
            outputLines.push(singleLineMatch[1]);
            outputLines.push('$$');

            edits.push({
                inputRange: { start: currentInputLine, end: currentInputLine },
                outputRange: { start: outputStart, end: outputStart + 2 }
            });

            outputLine += 3;
            continue;
        }

        // =========================================
        // CASE 3: Normal line (1:1 mapping, no edit needed)
        // =========================================
        outputLines.push(line);
        outputLine++;
    }

    return {
        content: outputLines.join('\n'),
        edits
    };
}



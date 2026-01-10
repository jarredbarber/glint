/**
 * Preprocessor for EXTENDED math syntax:
 * - $$$ ... $$$ → align environment
 * - $$$* ... $$$ → align* environment (no equation numbers)
 * - $$* ... $$ → display math (NO NUMBER)
 * 
 * Standard $$ ... $$ blocks are left untouched for remark-math to handle.
 * 
 * This version creates a precise LINE MAPPING by tracking all replacements
 * against the ORIGINAL markdown to avoid cumulative errors.
 */

export interface LineMapping {
    // Maps processed line number → original source line number
    processedToSource: Map<number, number>;
}

export interface PreprocessResult {
    content: string;
    lineMapping: LineMapping;
}

interface ReplacementInfo {
    origStartLine: number;  // 1-indexed line in ORIGINAL markdown
    origLineCount: number;   // Line count in original
    newLineCount: number;    // Line count in replacement
}

export function preprocessGlintMath(markdown: string): PreprocessResult {
    const replacements: ReplacementInfo[] = [];
    const originalLines = markdown.split('\n');
    const origLineCount = originalLines.length;

    // Helper to find line number from character offset in ORIGINAL markdown
    const getLineNumber = (charOffset: number): number => {
        const before = markdown.substring(0, charOffset);
        return before.split('\n').length;
    };

    // First pass: find ALL matches and their positions in ORIGINAL markdown
    // before any transformations

    // Find $$$ ... $$$ matches
    const alignRegex = /\$\$\$(\*?)\n([\s\S]*?)\n\$\$\$/g;
    let match;
    const allMatches: Array<{
        index: number,
        origMatch: string,
        replacement: string,
        type: 'align' | 'star'
    }> = [];

    while ((match = alignRegex.exec(markdown)) !== null) {
        const star = match[1];
        const content = match[2];
        const env = star === '*' ? 'align*' : 'align';
        const noNum = star === '*' ? '\\htmlClass{no-number}{}' : '';
        const latex = `$$\n${noNum}\\begin{${env}}\n${content}\n\\end{${env}}\n$$`;

        allMatches.push({
            index: match.index,
            origMatch: match[0],
            replacement: latex,
            type: 'align'
        });
    }

    // Find $$* ... $$ matches (in original, not overlapping with $$$ matches)
    const starRegex = /\$\$\*\s*([\s\S]*?)\s*\$\$/g;
    while ((match = starRegex.exec(markdown)) !== null) {
        // Skip if this overlaps with any $$$ match
        const overlaps = allMatches.some(m =>
            (match!.index >= m.index && match!.index < m.index + m.origMatch.length) ||
            (m.index >= match!.index && m.index < match!.index + match![0].length)
        );
        if (overlaps) continue;

        const content = match[1];
        const latex = `$$\n\\htmlClass{no-number}{}\n${content.trim()}\n$$`;

        allMatches.push({
            index: match.index,
            origMatch: match[0],
            replacement: latex,
            type: 'star'
        });
    }

    // Sort by position
    allMatches.sort((a, b) => a.index - b.index);

    // Record replacements with line info from ORIGINAL
    for (const m of allMatches) {
        replacements.push({
            origStartLine: getLineNumber(m.index),
            origLineCount: m.origMatch.split('\n').length,
            newLineCount: m.replacement.split('\n').length
        });
    }

    // Apply replacements (from end to preserve indices)
    let result = markdown;
    for (let i = allMatches.length - 1; i >= 0; i--) {
        const m = allMatches[i];
        result = result.substring(0, m.index) +
            m.replacement +
            result.substring(m.index + m.origMatch.length);
    }

    // Build precise line mapping
    const procLines = result.split('\n').length;
    const processedToSource = new Map<number, number>();

    // For each processed line, compute the corresponding source line
    // by tracking how replacements shift line numbers

    let procLine = 1;
    let srcLine = 1;
    let replIdx = 0;

    while (procLine <= procLines && srcLine <= origLineCount) {
        // Check if we're at a replacement
        if (replIdx < replacements.length && srcLine === replacements[replIdx].origStartLine) {
            const r = replacements[replIdx];

            // Map all lines in this replacement block to the original start line
            for (let i = 0; i < r.newLineCount && procLine <= procLines; i++) {
                // Map to the corresponding line within the original block if possible
                const offsetInBlock = Math.floor(i * r.origLineCount / r.newLineCount);
                processedToSource.set(procLine, r.origStartLine + offsetInBlock);
                procLine++;
            }

            srcLine += r.origLineCount;
            replIdx++;
        } else {
            // Normal line - 1:1 mapping
            processedToSource.set(procLine, srcLine);
            procLine++;
            srcLine++;
        }
    }

    // Fill any remaining processed lines
    while (procLine <= procLines) {
        processedToSource.set(procLine, origLineCount);
        procLine++;
    }

    return {
        content: result,
        lineMapping: { processedToSource }
    };
}

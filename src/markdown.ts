import matter from 'gray-matter';

export interface ParsedMarkdown {
    content: string;
    title: string | null;
    frontmatter: Record<string, unknown>;
    contentStartLine: number;
}

/**
 * Fix single-line display math for remark-math compatibility.
 * 
 * remark-math treats single-line $$ content $$ as INLINE math.
 * This function converts them to multi-line format to trigger display mode.
 * 
 * Important: This is LINE-PRESERVING. Each single-line $$ becomes 3 lines,
 * but this happens at the start before line mapping begins.
 */
function fixDisplayMath(content: string): string {
    const lines = content.split('\n');
    const result: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Check for single-line display math: $$ content $$ on its own line
        // The regex: starts with optional whitespace, $$, content, $$, optional whitespace
        const displayMathMatch = line.match(/^(\s*)\$\$\s*(.+?)\s*\$\$(\s*)$/);

        if (displayMathMatch) {
            const [, leadingSpace, mathContent] = displayMathMatch;
            // Check if this appears to be on its own paragraph
            const prevEmpty = i === 0 || lines[i - 1].trim() === '';
            const nextEmpty = i === lines.length - 1 || lines[i + 1].trim() === '';

            if (prevEmpty && nextEmpty) {
                // Split into multi-line format
                result.push(leadingSpace + '$$');
                result.push(mathContent);
                result.push('$$');
                continue;
            }
        }

        result.push(line);
    }

    return result.join('\n');
}

/**
 * Parse markdown, extracting frontmatter and title.
 * 
 * Strips frontmatter and optionally the first H1 heading.
 * Returns the content start line offset for source mapping.
 * 
 * @param raw - Raw markdown content
 * @param stripH1 - Whether to strip the first H1 heading (default: true)
 * @returns Parsed content with metadata
 */
// Browser-safe fallback frontmatter parser for the common cases gray-matter can't reach
// without Buffer: `key: scalar`, quoted scalars, and inline `[a, b]` arrays (#67).
function parseFrontmatterLite(block: string): Record<string, unknown> {
    const unquote = (s: string) => s.replace(/^["']|["']$/g, '').trim();
    const data: Record<string, unknown> = {};
    for (const line of block.split('\n')) {
        const m = line.match(/^\s*([\w-]+)\s*:\s*(.*)$/);
        if (!m) continue;
        const [, key, rawValue] = m;
        const value = rawValue.trim();
        if (value.startsWith('[') && value.endsWith(']')) {
            data[key] = value.slice(1, -1).split(',').map((v) => unquote(v)).filter(Boolean);
        } else if (value !== '') {
            data[key] = unquote(value);
        }
    }
    return data;
}

export function parseMarkdown(raw: string, stripH1: boolean = true): ParsedMarkdown {
    let frontmatter: Record<string, unknown> = {};
    let content = raw;
    let contentStartLine = 1;

    // 1. Handle frontmatter
    let processedRaw = raw;
    // Body with the frontmatter block removed. Used as the fallback when the YAML
    // parser throws (e.g. gray-matter needs Buffer, which is absent in the browser
    // bundle) so frontmatter never leaks into rendered output. See #52.
    let bodyAfterFrontmatter = raw;
    if (raw.startsWith('---')) {
        const endOfFrontmatter = raw.indexOf('\n---', 3);
        if (endOfFrontmatter !== -1) {
            const frontmatterText = raw.substring(0, endOfFrontmatter + 4);
            contentStartLine = frontmatterText.split('\n').length + 1;
            // Drop the leading newline after the closing --- so the body starts clean.
            bodyAfterFrontmatter = raw.substring(endOfFrontmatter + 4).replace(/^\n/, '');

            // Fix unquoted colons in values (common user error)
            // e.g. "title: Project: Zero" -> "title: "Project: Zero""
            const fixedFrontmatter = frontmatterText.split('\n').map(line => {
                // Match "key: value" where value contains a colon and isn't quoted
                // Regex explanation:
                // ^(\s*[\w-]+\s*:)  -> Group 1: Key (e.g. "title:")
                // \s+               -> Whitespace separator
                // (?!["'|>\-\[\{\*\&\!]) -> Negative lookahead: not starting with quote, block char, list dash, flow style, or special YAML chars
                // (.*:.*)$           -> Group 2: Value containing a colon
                return line.replace(/^(\s*[\w-]+\s*:)\s+(?!["'|>\-\[\{\*\&\!])(.*:.*)$/, '$1 "$2"');
            }).join('\n');

            processedRaw = fixedFrontmatter + raw.substring(endOfFrontmatter + 4);
        }
    }

    try {
        const result = matter(processedRaw);
        frontmatter = result.data;
        content = result.content;
    } catch {
        // Fallback: gray-matter threw (it needs Buffer, absent in the browser bundle — #52).
        // Strip the block so it never renders, and parse the common key/value + inline-array
        // shapes ourselves so frontmatter values are still available in the browser (#67).
        content = bodyAfterFrontmatter;
        if (raw.startsWith('---')) {
            const end = raw.indexOf('\n---', 3);
            if (end !== -1) frontmatter = parseFrontmatterLite(raw.substring(3, end));
        }
    }

    // 2. Fix display math (before any line-sensitive operations)
    content = fixDisplayMath(content);

    // 3. Handle H1 stripping. The first `# ` heading is the canonical title (#67);
    // a frontmatter `title:` is treated as ordinary metadata, not the doc title.
    let title: string | null = null;
    let additionalLinesStripped = 0;

    {
        const h1Match = content.match(/^#\s+(.+)$/m);
        if (h1Match) {
            title = h1Match[1].trim();

            if (stripH1) {
                // Find the line number of the H1 in the content
                const beforeH1 = content.substring(0, h1Match.index);
                const h1LineInContent = beforeH1.split('\n').length;

                // Remove the H1 line
                const lines = content.split('\n');
                lines.splice(h1LineInContent - 1, 1);

                // Also strip leading blank lines after removal
                let leadingBlanks = 0;
                while (leadingBlanks < lines.length && lines[leadingBlanks].trim() === '') {
                    leadingBlanks++;
                }
                if (leadingBlanks > 0) {
                    lines.splice(0, leadingBlanks);
                }

                content = lines.join('\n');
                additionalLinesStripped = 1 + leadingBlanks; // H1 + blank lines
            }
        }
    }

    return {
        content,
        title,
        frontmatter,
        contentStartLine: contentStartLine + additionalLinesStripped
    };
}

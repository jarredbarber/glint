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
 * remark-math treats single-line `$$ content $$` as INLINE math. To trigger
 * display mode the delimiters must sit on their own lines. When the math line
 * is fenced by blank lines (its own paragraph) we move the `$$` delimiters onto
 * those surrounding blank lines rather than inserting new ones. The math content
 * keeps its ORIGINAL source line and the total line count is unchanged, so
 * downstream source-line mapping (tasks/comments/section edits) stays correct
 * (#65). At a document boundary with no blank line to reuse we leave the line
 * as-is (it renders inline) — correctness of line mapping over display there.
 */
function fixDisplayMath(content: string): string {
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^(\s*)\$\$\s*(.+?)\s*\$\$(\s*)$/);
        if (!m) continue;
        const hasBlankBefore = i > 0 && lines[i - 1].trim() === '';
        const hasBlankAfter = i < lines.length - 1 && lines[i + 1].trim() === '';
        if (hasBlankBefore && hasBlankAfter) {
            lines[i - 1] = m[1] + '$$';
            lines[i] = m[2];
            lines[i + 1] = '$$';
        }
    }

    return lines.join('\n');
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
// without Buffer: scalars, inline arrays, and one-level nested maps (#67, #107).
function parseFrontmatterValue(rawValue: string): unknown {
    const unquote = (value: string) => value.replace(/^["']|["']$/g, '').trim();
    const value = rawValue.trim();
    if (value.startsWith('[') && value.endsWith(']')) {
        return value.slice(1, -1).split(',').map((item) => unquote(item)).filter(Boolean);
    }
    return unquote(value);
}

function parseFrontmatterLite(block: string): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    let nestedMap: Record<string, unknown> | null = null;

    for (const line of block.split('\n')) {
        const nested = line.match(/^\s+([\w-]+)\s*:\s*(.+)$/);
        if (nested && nestedMap) {
            nestedMap[nested[1]] = parseFrontmatterValue(nested[2]);
            continue;
        }

        const topLevel = line.match(/^([\w-]+)\s*:\s*(.*)$/);
        if (!topLevel) {
            nestedMap = null;
            continue;
        }

        const [, key, rawValue] = topLevel;
        if (rawValue.trim() === '') {
            nestedMap = {};
            data[key] = nestedMap;
        } else {
            data[key] = parseFrontmatterValue(rawValue);
            nestedMap = null;
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

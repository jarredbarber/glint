import matter from 'gray-matter';

export interface ParsedMarkdown {
    content: string;
    title: string | null;
    frontmatter: Record<string, unknown>;
    contentStartLine: number;
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
export function parseMarkdown(raw: string, stripH1: boolean = true): ParsedMarkdown {
    let frontmatter: Record<string, unknown> = {};
    let content = raw;
    let contentStartLine = 1;

    // 1. Handle frontmatter
    if (raw.startsWith('---')) {
        const endOfFrontmatter = raw.indexOf('\n---', 3);
        if (endOfFrontmatter !== -1) {
            const frontmatterText = raw.substring(0, endOfFrontmatter + 4);
            contentStartLine = frontmatterText.split('\n').length + 1;
        }
    }

    try {
        const result = matter(raw);
        frontmatter = result.data;
        content = result.content;
    } catch {
        // Fallback: treat everything as content if frontmatter parsing fails
    }

    // 2. Handle H1 stripping
    let title: string | null = null;
    let additionalLinesStripped = 0;

    // Priority 1: frontmatter title
    if (frontmatter.title && typeof frontmatter.title === 'string') {
        title = frontmatter.title;
    }

    // Priority 2: First H1 (optionally strip it)
    if (!title || stripH1) {
        const h1Match = content.match(/^#\s+(.+)$/m);
        if (h1Match) {
            if (!title) title = h1Match[1].trim();

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

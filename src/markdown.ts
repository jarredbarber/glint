import matter from 'gray-matter';

export interface ParsedMarkdown {
    content: string;
    title: string | null;
    frontmatter: Record<string, unknown>;
    contentStartLine: number;
}

/**
 * Extract title from markdown content in order of priority:
 * 1. YAML frontmatter `title:` field
 * 2. First # heading
 * 3. null (caller should fall back to filename)
 */
export function parseMarkdown(raw: string): ParsedMarkdown {
    let frontmatter: Record<string, unknown> = {};
    let content = raw;
    let contentStartLine = 1;

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
    } catch (e) {
        // Fallback: treat everything as content if frontmatter parsing fails
        console.warn('Failed to parse frontmatter, treating as plain markdown.');
    }

    // Priority 1: frontmatter title
    if (frontmatter.title && typeof frontmatter.title === 'string') {
        return { content, title: frontmatter.title, frontmatter, contentStartLine };
    }

    // Priority 2: first H1 heading - extract and remove it from content
    const h1Match = content.match(/^#\s+(.+)$/m);
    if (h1Match) {
        // Remove the H1 line 
        const afterRemoval = content.replace(/^#\s+.+$/m, '');
        const strippedContent = afterRemoval.trimStart();

        // Count how many lines were stripped total:
        // = (original content lines) - (remaining content lines)
        const originalLineCount = content.split('\n').length;
        const remainingLineCount = strippedContent.split('\n').length;
        const linesStripped = originalLineCount - remainingLineCount;

        const adjustedStartLine = contentStartLine + linesStripped;

        return { content: strippedContent, title: h1Match[1].trim(), frontmatter, contentStartLine: adjustedStartLine };
    }

    return { content, title: null, frontmatter, contentStartLine };
}

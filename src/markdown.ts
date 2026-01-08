import matter from 'gray-matter';

export interface ParsedMarkdown {
    content: string;
    title: string | null;
    frontmatter: Record<string, unknown>;
}

/**
 * Extract title from markdown content in order of priority:
 * 1. YAML frontmatter `title:` field
 * 2. First # heading
 * 3. null (caller should fall back to filename)
 */
export function parseMarkdown(raw: string): ParsedMarkdown {
    const { data: frontmatter, content } = matter(raw);

    // Priority 1: frontmatter title
    if (frontmatter.title && typeof frontmatter.title === 'string') {
        return { content, title: frontmatter.title, frontmatter };
    }

    // Priority 2: first H1 heading
    const h1Match = content.match(/^#\s+(.+)$/m);
    if (h1Match) {
        return { content, title: h1Match[1].trim(), frontmatter };
    }

    return { content, title: null, frontmatter };
}

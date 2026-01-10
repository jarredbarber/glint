import matter from 'gray-matter';
import { SourceMap } from './source-map.js';

export interface ParsedMarkdown {
    content: string;
    title: string | null;
    frontmatter: Record<string, unknown>;
    contentStartLine: number;
}

/**
 * Extract title and content using SourceMap logic.
 * 
 * @param raw - Raw markdown content
 * @returns Parsed content with H1 stripped (if applicable), title, and line info.
 */
export function parseMarkdown(raw: string): ParsedMarkdown {
    // metadata is now handled by SourceMap
    const { sourceMap, content, title, frontmatter } = SourceMap.fromMarkdown(raw);

    // Calculate the start line of the content relative to the source.
    // If the content is empty, default to 1 or whatever reasonable value.
    // If content exists, map the first line (1) back to source.
    const contentStartLine = content.length > 0 ? sourceMap.getSourceLine(1) : 1;

    return { content, title, frontmatter, contentStartLine };
}

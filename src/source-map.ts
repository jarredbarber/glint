/**
 * ============================================================================
 * SOURCE MAP - Line Mapping for Glint
 * ============================================================================
 * 
 * This module provides accurate line number tracking from rendered HTML back
 * to the original markdown source. It handles:
 * 
 * 1. Frontmatter stripping (YAML at start of file)
 * 2. H1 title extraction (first heading may be removed)
 * 3. Math preprocessing (single-line $$ expands to 3 lines, $$$ blocks expand)
 * 
 * The SourceMap is immutable - each transform produces a new SourceMap.
 * 
 * ============================================================================
 */

import matter from 'gray-matter';

/**
 * Represents a range of lines (1-indexed, inclusive).
 */
export interface LineRange {
    start: number;
    end: number;
}

/**
 * Describes a single edit: how lines in the input map to lines in the output.
 */
export interface Edit {
    /** Lines in the content BEFORE this transform */
    inputRange: LineRange;
    /** Lines in the content AFTER this transform */
    outputRange: LineRange;
}

/**
 * Result of a content transformation.
 */
export interface TransformResult {
    content: string;
    edits: Edit[];
}

/**
 * Function signature for content transformers.
 */
export type TransformFn = (content: string) => TransformResult;

/**
 * Internal segment tracking how output lines map to original lines.
 */
interface Segment {
    /** Range of lines in the current processed content */
    outputRange: LineRange;
    /** Range of lines in the ORIGINAL source file */
    originalRange: LineRange;
}

/**
 * Immutable source map tracking line transformations.
 * 
 * Usage:
 *   const { sourceMap, content, title } = SourceMap.fromMarkdown(raw);
 *   const { sourceMap: sm2, content: processed } = sourceMap.transform(mathPreprocessor);
 *   const originalLine = sm2.getSourceLine(processedLine);
 */
export class SourceMap {
    private readonly segments: Segment[];

    private constructor(segments: Segment[]) {
        this.segments = segments;
    }

    /**
     * Create a source map from raw markdown content.
     * Handles frontmatter extraction and optional H1 stripping.
     * 
     * @param raw - The raw file content
     * @param stripH1 - Whether to remove the first H1 heading from content
     * @returns SourceMap, processed content, extracted title, and frontmatter
     */
    static fromMarkdown(raw: string, stripH1: boolean = true): {
        sourceMap: SourceMap;
        content: string;
        title: string | null;
        frontmatter: Record<string, unknown>;
    } {
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

        // 3. Build initial segment
        // Content line 1 maps to original line (contentStartLine + additionalLinesStripped)
        const totalLines = content.split('\n').length;
        const segment: Segment = {
            outputRange: { start: 1, end: totalLines },
            originalRange: {
                start: contentStartLine + additionalLinesStripped,
                end: contentStartLine + additionalLinesStripped + totalLines - 1
            }
        };

        return {
            sourceMap: new SourceMap([segment]),
            content,
            title,
            frontmatter
        };
    }

    /**
     * Apply a content transformation and produce a new SourceMap.
     * 
     * @param content - Current processed content
     * @param transformFn - Function that transforms content and returns edits
     * @returns New SourceMap and transformed content
     */
    transform(content: string, transformFn: TransformFn): {
        sourceMap: SourceMap;
        content: string;
    } {
        const { content: newContent, edits } = transformFn(content);

        if (edits.length === 0) {
            // No changes, return same mapping for new content
            return { sourceMap: this, content: newContent };
        }

        // Sort edits by input position
        edits.sort((a, b) => a.inputRange.start - b.inputRange.start);

        // Build new segments by composing edits with existing mapping
        const newSegments: Segment[] = [];
        let outputOffset = 0; // Cumulative line shift from edits

        for (const segment of this.segments) {
            // Process each edit that affects this segment
            let segmentStart = segment.outputRange.start;
            const segmentEnd = segment.outputRange.end;

            for (const edit of edits) {
                if (edit.inputRange.start > segmentEnd || edit.inputRange.end < segmentStart) {
                    continue; // Edit doesn't affect this segment
                }

                // Part before edit (unchanged)
                if (edit.inputRange.start > segmentStart) {
                    const unchangedOutput: LineRange = {
                        start: segmentStart + outputOffset,
                        end: edit.inputRange.start - 1 + outputOffset
                    };
                    const unchangedOriginal: LineRange = {
                        start: segment.originalRange.start + (segmentStart - segment.outputRange.start),
                        end: segment.originalRange.start + (edit.inputRange.start - 1 - segment.outputRange.start)
                    };
                    newSegments.push({ outputRange: unchangedOutput, originalRange: unchangedOriginal });
                }

                // The edit itself - all output lines map to the input range's original lines
                const editOriginalStart = segment.originalRange.start +
                    (Math.max(edit.inputRange.start, segment.outputRange.start) - segment.outputRange.start);
                const editOriginalEnd = segment.originalRange.start +
                    (Math.min(edit.inputRange.end, segment.outputRange.end) - segment.outputRange.start);

                const editOutput: LineRange = {
                    start: edit.outputRange.start + outputOffset,
                    end: edit.outputRange.end + outputOffset
                };

                newSegments.push({
                    outputRange: editOutput,
                    originalRange: { start: editOriginalStart, end: editOriginalEnd }
                });

                // Update offset for subsequent segments
                const inputLines = edit.inputRange.end - edit.inputRange.start + 1;
                const outputLines = edit.outputRange.end - edit.outputRange.start + 1;
                outputOffset += outputLines - inputLines;

                segmentStart = edit.inputRange.end + 1;
            }

            // Part after all edits (unchanged)
            if (segmentStart <= segmentEnd) {
                const unchangedOutput: LineRange = {
                    start: segmentStart + outputOffset,
                    end: segmentEnd + outputOffset
                };
                const unchangedOriginal: LineRange = {
                    start: segment.originalRange.start + (segmentStart - segment.outputRange.start),
                    end: segment.originalRange.end
                };
                newSegments.push({ outputRange: unchangedOutput, originalRange: unchangedOriginal });
            }
        }

        return {
            sourceMap: new SourceMap(newSegments),
            content: newContent
        };
    }

    /**
     * Get the original source line number for a processed content line.
     * 
     * @param processedLine - Line number in the processed content (1-indexed)
     * @returns Line number in the original source file (1-indexed)
     */
    getSourceLine(processedLine: number): number {
        for (const segment of this.segments) {
            if (processedLine >= segment.outputRange.start &&
                processedLine <= segment.outputRange.end) {
                // Interpolate within the segment
                const outputSpan = segment.outputRange.end - segment.outputRange.start + 1;
                const originalSpan = segment.originalRange.end - segment.originalRange.start + 1;

                if (outputSpan === originalSpan) {
                    // 1:1 mapping
                    const offset = processedLine - segment.outputRange.start;
                    return segment.originalRange.start + offset;
                } else {
                    // Many:1 or 1:many mapping - return the start of the original range
                    // This handles cases like math expansion where 1 line becomes 3
                    return segment.originalRange.start;
                }
            }
        }

        // Fallback: shouldn't happen if segments are correct
        console.warn(`[SourceMap] No segment found for processed line ${processedLine}`);
        return processedLine;
    }

    /**
     * Debug: Get all segments for inspection.
     */
    toJSON(): object {
        return {
            segments: this.segments.map(s => ({
                output: `${s.outputRange.start}-${s.outputRange.end}`,
                original: `${s.originalRange.start}-${s.originalRange.end}`
            }))
        };
    }

    /**
     * Debug: Print a readable representation.
     */
    toString(): string {
        return this.segments
            .map(s => `[${s.outputRange.start}-${s.outputRange.end}] → [${s.originalRange.start}-${s.originalRange.end}]`)
            .join('\n');
    }
}

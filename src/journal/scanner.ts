import { StorageManager } from '../storage/index.js';
import type { FileJournal, JournalSection, DateGroup } from './types.js';
import { parseMarkdown } from '../markdown.js';

export class JournalScanner {
    private cache: Map<string, FileJournal> = new Map();
    private storage: StorageManager;

    // Matches ## YYYY-MM-DD
    private DATE_REGEX = /^##\s+(\d{4}-\d{2}-\d{2})(?:\s+.*)?$/;

    constructor(storage: StorageManager) {
        this.storage = storage;
    }

    /**
     * Scan all markdown files in the content root.
     */
    async scanAll(): Promise<DateGroup[]> {
        const allSections: JournalSection[] = [];
        await this.scanDirectory('', allSections);
        return this.aggregateByDate(allSections);
    }

    private async scanDirectory(dir: string, allSections: JournalSection[]) {
        try {
            const entries = await this.storage.list(dir);

            for (const entry of entries) {
                const relativePath = dir ? `${dir}/${entry.name}` : entry.name;

                if (entry.type === 'directory') {
                    if (entry.name.startsWith('.') || entry.name.endsWith('.assets')) continue;
                    await this.scanDirectory(relativePath, allSections);
                } else if (entry.type === 'file' && entry.name.endsWith('.md')) {
                    const sections = await this.scanFile(relativePath);
                    allSections.push(...sections);
                }
            }
        } catch (err) {
            console.error(`Error scanning directory ${dir}:`, err);
        }
    }

    private async scanFile(relativePath: string): Promise<JournalSection[]> {
        try {
            const stats = await this.storage.stat(relativePath);
            const mtime = stats.mtime.getTime();

            const cached = this.cache.get(relativePath);
            if (cached && cached.mtime === mtime) {
                return cached.sections;
            }

            // Read content
            const rawContent = await this.storage.read(relativePath);
            const { title: fileTitle } = parseMarkdown(rawContent, false);
            const actualFileTitle = fileTitle || relativePath;

            // We use parseMarkdown to get the title and strip frontmatter if necessary,
            // but for section extraction we need to know the lines.
            // Actually, let's keep it simple and just parse the raw lines for now,
            // but maybe skip frontmatter.

            const lines = rawContent.split('\n');
            const sections: JournalSection[] = [];

            let currentSection: JournalSection | null = null;
            let currentContent: string[] = [];

            for (let index = 0; index < lines.length; index++) {
                const line = lines[index];
                const match = line.match(this.DATE_REGEX);
                if (match) {
                    // If we were in a section, save it
                    if (currentSection) {
                        currentSection.content = currentContent.join('\n').trim();
                        currentSection.endLine = index;
                        sections.push(currentSection);
                    }

                    // Start new section
                    const date = match[1];
                    currentSection = {
                        file: relativePath,
                        fileTitle: actualFileTitle,
                        title: date,
                        content: '',
                        startLine: index + 1,
                        endLine: index + 1,
                    };
                    currentContent = [];
                } else if (currentSection) {
                    currentContent.push(line);
                }
            }

            // Handle last section
            if (currentSection) {
                currentSection.content = currentContent.join('\n').trim();
                currentSection.endLine = lines.length;
                sections.push(currentSection);
            }

            this.cache.set(relativePath, {
                path: relativePath,
                mtime,
                sections
            });

            return sections;
        } catch (error) {
            console.error(`Error scanning file ${relativePath}:`, error);
            return [];
        }
    }

    /**
     * Group sections by date and sort descending.
     */
    aggregateByDate(sections: JournalSection[]): DateGroup[] {
        const groups = new Map<string, JournalSection[]>();

        for (const section of sections) {
            const date = section.title; // In our current impl, title is the date
            if (!groups.has(date)) {
                groups.set(date, []);
            }
            groups.get(date)!.push(section);
        }

        return Array.from(groups.entries())
            .map(([date, sections]) => ({ date, sections }))
            .sort((a, b) => b.date.localeCompare(a.date));
    }

    /**
     * Invalidate cache for a specific file.
     */
    invalidate(relativePath: string) {
        this.cache.delete(relativePath);
    }

    /**
     * Force refresh of a specific file.
     */
    async refresh(relativePath: string): Promise<void> {
        await this.scanFile(relativePath);
    }
}

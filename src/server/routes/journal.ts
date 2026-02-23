import type { FastifyInstance } from 'fastify';
import { VFile } from 'vfile';
import { JournalScanner } from '../../journal/scanner.js';
import type { DateGroup } from '../../journal/types.js';
import * as renderer from '../../renderer.js';
import { GlintConfig } from '../../config.js';
import { buildFileTree } from '../../filetree.js';
import { StorageManager } from '../../storage/index.js';

export async function setupJournalRoutes(
    fastify: FastifyInstance,
    getConfig: () => GlintConfig,
    scanner: JournalScanner,
    storage: StorageManager,
    processor: any // Unified processor
) {

    // API: Get aggregated journal entries
    fastify.get('/api/journal', async (request, reply) => {
        reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
        const { before, after, file } = request.query as {
            before?: string;
            after?: string;
            file?: string;
        };

        let groups = await scanner.scanAll();

        // Filtering
        if (before || after || file) {
            groups = groups.map(group => {
                if (before && group.date >= before) return null;
                if (after && group.date <= after) return null;

                const filteredSections = file
                    ? group.sections.filter(s => s.file === file)
                    : group.sections;

                if (filteredSections.length === 0) return null;

                return { ...group, sections: filteredSections };
            }).filter((g): g is DateGroup => g !== null);
        }

        // Render markdown content for each section
        for (const group of groups) {
            for (const section of group.sections) {
                if (section.content) {
                    try {
                        const file = new VFile({ value: section.content });
                        const result = await processor.process(file);
                        section.renderedContent = String(result);
                    } catch (err) {
                        // Fallback to escaped content if rendering fails
                        section.renderedContent = section.content
                            .replace(/&/g, '&amp;')
                            .replace(/</g, '&lt;')
                            .replace(/>/g, '&gt;')
                            .replace(/\n/g, '<br>');
                    }
                }
            }
        }

        return groups;
    });

    // Page: Journal View
    fastify.get('/d/journal', async (request, reply) => {
        const config = getConfig();
        const fileTree = await buildFileTree(storage);

        const html = renderer.renderHtml({
            title: 'Journal',
            content: '<div id="journal-view-root">Loading journal...</div>',
            fileTree,
            config,
            scripts: ['/assets/journal-view.bundle.js'],
            styles: ['/assets/journal-view.css'],
            currentPath: '/d/journal'
        });

        reply.type('text/html').send(html);
    });

    // Redirect old journal route
    fastify.get('/journal', async (request, reply) => {
        return reply.redirect('/d/journal');
    });
}

import type { FastifyInstance } from 'fastify';
import { JournalScanner } from '../../journal/scanner.js';
import * as renderer from '../../renderer.js';
import { GlintConfig } from '../../config.js';
import { buildFileTree } from '../../filetree.js';
import { StorageManager } from '../../storage/index.js';

export async function setupJournalRoutes(
    fastify: FastifyInstance,
    getConfig: () => GlintConfig,
    scanner: JournalScanner,
    storage: StorageManager
) {

    // API: Get aggregated journal entries
    fastify.get('/api/journal', async (request, reply) => {
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
            }).filter((g): g is any => g !== null);
        }

        return groups;
    });

    // Page: Journal View
    fastify.get('/journal', async (request, reply) => {
        const config = getConfig();
        const fileTree = await buildFileTree(storage);

        const html = renderer.renderHtml({
            title: 'Journal',
            content: '<div id="journal-view-root">Loading journal...</div>',
            fileTree,
            config,
            scripts: ['/assets/journal-view.bundle.js'],
            styles: ['/assets/journal-view.css'],
            currentPath: '/journal',
            authEnabled: config.auth?.enabled ?? false,
            authenticated: request.isAuthenticated()
        });

        reply.type('text/html').send(html);
    });
}

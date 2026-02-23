import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import { type GlintConfig } from '../../config.js';
import { StorageManager } from '../../storage/index.js';
import { parseMarkdown } from '../../markdown.js';
import { VFile } from 'vfile';


export async function setupDocumentRoutes(
    fastify: FastifyInstance,
    storageManager: StorageManager,
    getConfig: () => GlintConfig,
    processor: any // Unified processor
) {

    // GET /api/documents/*
    fastify.get('/api/documents/*', async (request, reply) => {
        const path = (request.params as { '*': string })['*'];
        const render = (request.query as { render?: string }).render === 'true';

        try {
            const exists = await storageManager.exists(path);
            if (!exists) {
                return reply.code(404).send({ error: 'Document not found' });
            }

            const rawContent = await storageManager.read(path);

            if (render) {
                // Return rendered HTML
                const { content, title, frontmatter, contentStartLine } = parseMarkdown(rawContent);
                const file = new VFile({ value: content });
                file.data.contentStartLine = contentStartLine;
                file.data.filePath = path;

                const vfile = await processor.process(file);
                const html = String(vfile);
                const headings = vfile.data.headings || [];

                return {
                    html,
                    title,
                    frontmatter,
                    headings,
                    hash: crypto.createHash('md5').update(rawContent).digest('hex')
                };
            } else {
                // Return raw markdown
                const hash = crypto.createHash('md5').update(rawContent).digest('hex');
                return {
                    markdown: rawContent,
                    hash
                };
            }
        } catch (err: any) {
            request.log.error(err);
            return reply.code(500).send({ error: 'Failed to read document' });
        }
    });

    // PUT /api/documents/*
    fastify.put('/api/documents/*', async (request, reply) => {
        const path = (request.params as { '*': string })['*'];
        const { content, message, expectedHash } = request.body as {
            content: string;
            message?: string;
            expectedHash?: string
        };

        if (typeof content !== 'string') {
            return reply.code(400).send({ error: 'Content must be a string' });
        }

        try {
            await storageManager.write(path, content, {
                message,
                expectedHash
            });
            return { success: true };
        } catch (err: any) {
            if (err.message.includes('Conflict')) {
                return reply.code(409).send({ error: err.message });
            }
            request.log.error(err);
            return reply.code(500).send({ error: 'Failed to write document' });
        }
    });

    // DELETE /api/documents/*
    fastify.delete('/api/documents/*', async (request, reply) => {
        const path = (request.params as { '*': string })['*'];

        try {
            await storageManager.delete(path);
            return { success: true };
        } catch (err: any) {
            request.log.error(err);
            return reply.code(500).send({ error: 'Failed to delete document' });
        }
    });

    // POST /api/documents/render (Preview)
    fastify.post('/api/documents/render', async (request, reply) => {
        const { markdown } = request.body as { markdown: string };
        if (typeof markdown !== 'string') {
            return reply.code(400).send({ error: 'Markdown must be a string' });
        }

        try {
            const { content, title, frontmatter } = parseMarkdown(markdown);
            const file = new VFile({ value: content });

            // For preview, we don't have a path or source lines
            const vfile = await processor.process(file);
            const html = String(vfile);
            const headings = vfile.data.headings || [];

            return {
                html,
                title,
                frontmatter,
                headings
            };
        } catch (err: any) {
            request.log.error(err);
            return reply.code(500).send({ error: 'Failed to render markdown' });
        }
    });

    // POST /api/documents/batch - Batch write multiple files atomically
    fastify.post('/api/documents/batch', async (request, reply) => {
        const { writes, message } = request.body as {
            writes: Array<{ path: string; content: string }>;
            message?: string;
        };

        if (!Array.isArray(writes) || writes.length === 0) {
            return reply.code(400).send({ error: 'Writes array is required and must not be empty' });
        }

        // Validate each write item
        for (const item of writes) {
            if (typeof item.path !== 'string' || typeof item.content !== 'string') {
                return reply.code(400).send({ error: 'Each write must have path and content strings' });
            }
        }

        try {
            await storageManager.batchWrite(writes, { message });
            return { success: true, filesWritten: writes.length };
        } catch (err: any) {
            request.log.error(err);
            return reply.code(500).send({ error: 'Failed to batch write documents' });
        }
    });
}

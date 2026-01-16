import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import { type GlintConfig, type AccessLevel } from '../../config.js';
import { StorageManager } from '../../storage/index.js';
import { parseMarkdown } from '../../markdown.js';
import { VFile } from 'vfile';
import { hasValidServiceToken } from '../auth.js';

export async function setupDocumentRoutes(
    fastify: FastifyInstance,
    storageManager: StorageManager,
    getConfig: () => GlintConfig,
    processor: any // Unified processor
) {
    // Middleware to check for service token or standard auth
    const requireServiceToken = async (request: FastifyRequest, reply: FastifyReply) => {
        const isValid = await hasValidServiceToken(request, getConfig());
        if (!isValid) {
            reply.code(401).send({ error: 'Valid service token required' });
            return false;
        }
        return true;
    };

    const checkAccess = (request: FastifyRequest, reply: FastifyReply, path: string, level: AccessLevel): boolean => {
        const access = request.getAccess(path);
        if (access === null) {
            reply.code(401).send({ error: 'Authentication required' });
            return false;
        }

        const levelHierarchy: Record<AccessLevel, number> = { view: 1, comment: 2, edit: 3 };
        if (levelHierarchy[access] < levelHierarchy[level]) {
            reply.code(403).send({ error: 'Insufficient permissions' });
            return false;
        }
        return true;
    };

    // GET /api/documents/*
    fastify.get('/api/documents/*', async (request, reply) => {
        const path = (request.params as { '*': string })['*'];
        const render = (request.query as { render?: string }).render === 'true';

        // Check for service token first (for Hector)
        let hasAccess = await hasValidServiceToken(request, getConfig());

        // If no service token, check standard user access
        if (!hasAccess) {
            if (!checkAccess(request, reply, path, 'view')) return;
        }

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

        // PUT requires service token (Hector)
        if (!await requireServiceToken(request, reply)) return;

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

        // DELETE requires service token (Hector)
        if (!await requireServiceToken(request, reply)) return;

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

        // Preview doesn't strictly need auth if it doesn't touch storage,
        // but we'll require at least 'view' access to the API generally or a service token.
        let hasAccess = await hasValidServiceToken(request, getConfig());
        if (!hasAccess) {
            // Check if user is authenticated at all
            if (!request.isAuthenticated()) {
                return reply.code(401).send({ error: 'Authentication required' });
            }
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

        // Batch writes require service token (Hector)
        if (!await requireServiceToken(request, reply)) return;

        try {
            await storageManager.batchWrite(writes, { message });
            return { success: true, filesWritten: writes.length };
        } catch (err: any) {
            request.log.error(err);
            return reply.code(500).send({ error: 'Failed to batch write documents' });
        }
    });
}

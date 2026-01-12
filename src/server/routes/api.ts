import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyMultipart from '@fastify/multipart';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { type GlintConfig, type AccessLevel, getConfigPath } from '../../config.js';
import { resolveContentPath } from '../../utils/fs-utils.js';
import { isForbiddenError, isNotFoundError } from '../../utils/errors.js';

export async function setupAPIRoutes(
    fastify: FastifyInstance,
    contentDir: string,
    getConfig: () => GlintConfig
) {

    // Helper to check access level and return 401/403 if insufficient
    const requireAccess = (
        request: FastifyRequest,
        reply: FastifyReply,
        urlPath: string,
        requiredLevel: AccessLevel
    ): boolean => {
        const access = request.getAccess(urlPath);
        if (access === null) {
            reply.code(401).send({ error: 'Authentication required', authRequired: true });
            return false;
        }

        const levelHierarchy: Record<AccessLevel, number> = { view: 1, comment: 2, edit: 3 };
        if (levelHierarchy[access] < levelHierarchy[requiredLevel]) {
            reply.code(403).send({ error: 'Insufficient permissions' });
            return false;
        }

        return true;
    };

    // Register multipart support
    await fastify.register(fastifyMultipart, {
        limits: {
            fileSize: 50 * 1024 * 1024 // 50 MB
        }
    });

    const IMAGE_EXTENSIONS: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.webp': 'image/webp',
        '.ico': 'image/x-icon',
    };

    // Asset Resolver Endpoint
    fastify.get('/api/asset/resolve', async (request, reply) => {
        try {
            const { path: assetPath, context } = request.query as { path: string, context?: string };

            if (!assetPath) {
                return reply.code(400).send({ error: 'Missing path parameter' });
            }

            let targetUrlPath = assetPath;

            // Resolve relative paths if context is provided
            if (context && !assetPath.startsWith('/')) {
                const contextDir = path.dirname(context);
                // Handle ./ prefix explicitly or just join
                const cleanAssetPath = assetPath.startsWith('./') ? assetPath.substring(2) : assetPath;
                targetUrlPath = path.join(contextDir, cleanAssetPath);
            }

            // Check access for the resolved path
            // Note: Currently we check 'view' access.
            if (!requireAccess(request, reply, targetUrlPath, 'view')) {
                return;
            }

            const { safePath, stats } = await resolveContentPath(contentDir, targetUrlPath, getConfig(), false);

            if (!stats || stats.isDirectory()) {
                return reply.code(404).send({ error: 'Asset not found' });
            }

            const ext = path.extname(safePath).toLowerCase();
            const contentType = IMAGE_EXTENSIONS[ext] || 'application/octet-stream';

            const fileBuffer = await fs.readFile(safePath);
            return reply.type(contentType).send(fileBuffer);

        } catch (err: unknown) {
            if (isForbiddenError(err)) return reply.code(403).send({ error: 'Forbidden' });
            if (isNotFoundError(err)) return reply.code(404).send({ error: 'Not Found' });
            request.log.error(err as Error);
            return reply.code(500).send({ error: 'Resolution failed' });
        }
    });

    // Theme Update Endpoint
    fastify.post('/api/theme', async (request, reply) => {
        try {
            const { theme } = request.body as { theme: string };
            const themes = ['default', 'everforest-dark', 'nord', 'gruvbox-dark', 'catppuccin-mocha', 'solarized-light'];

            if (themes.includes(theme)) {
                const configPath = await getConfigPath(contentDir);
                const currentConfig = getConfig();
                const newConfig = { ...currentConfig, theme };

                await fs.writeFile(configPath, JSON.stringify(newConfig, null, 4));
                // Config is auto-reloaded via server.ts file watcher
                return { success: true };
            }
            return reply.code(400).send({ error: 'Invalid theme' });
        } catch (err) {
            request.log.error(err);
            return reply.code(500).send({ error: 'Failed to update theme' });
        }
    });

    // Save Content
    fastify.post('/api/save', async (request, reply) => {
        try {
            const body = request.body as { path: string; content: string; hash?: string };
            if (typeof body.path !== 'string' || typeof body.content !== 'string') {
                return reply.code(400).send({ error: 'Missing path or content' });
            }

            // Check edit access
            if (!requireAccess(request, reply, body.path, 'edit')) {
                return;
            }

            const { safePath } = await resolveContentPath(contentDir, body.path, getConfig());

            // Optimistic locking
            if (body.hash) {
                try {
                    const existingContent = await fs.readFile(safePath, 'utf-8');
                    const existingHash = crypto.createHash('md5').update(existingContent).digest('hex');
                    if (existingHash !== body.hash) {
                        return reply.code(409).send({
                            error: 'Conflict: The file has been modified by someone else.',
                            conflict: true
                        });
                    }
                } catch (err) {
                    // If file doesn't exist, hash check is skipped
                }
            }

            await fs.writeFile(safePath, body.content, 'utf-8');
            const newHash = crypto.createHash('md5').update(body.content).digest('hex');

            return { success: true, hash: newHash };
        } catch (err: unknown) {
            if (isForbiddenError(err)) return reply.code(403).send({ error: 'Forbidden' });
            request.log.error(err as Error);
            return reply.code(500).send({ error: 'Failed to save file' });
        }
    });

    // Get Source
    fastify.get('/api/source/*', async (request, reply) => {
        const urlPath = (request.params as { '*': string })['*'] || '';

        // Require at least view access to read source
        if (!requireAccess(request, reply, urlPath, 'view')) {
            return;
        }

        try {
            const { safePath } = await resolveContentPath(contentDir, urlPath, getConfig(), false);
            const content = await fs.readFile(safePath, 'utf-8');
            const hash = crypto.createHash('md5').update(content).digest('hex');
            return { content, hash, path: urlPath };
        } catch (err: unknown) {
            if (isForbiddenError(err)) return reply.code(403).send({ error: 'Forbidden' });
            if (isNotFoundError(err)) return reply.code(404).send({ error: 'Not Found' });
            request.log.error(err as Error);
            return reply.code(500).send({ error: 'Internal Server Error' });
        }
    });

    // Upload Image
    fastify.post('/api/upload', async (request, reply) => {
        try {
            const parts = request.parts();
            let fileBuffer: Buffer | undefined;
            let filename: string | undefined;
            let articlePath: string | undefined;

            for await (const part of parts) {
                if (part.type === 'file') {
                    fileBuffer = await part.toBuffer();
                    filename = part.filename;
                } else if (part.fieldname === 'articlePath') {
                    articlePath = (part as any).value as string;
                }
            }

            if (!articlePath) {
                articlePath = (request.query as any).articlePath;
            }

            if (!fileBuffer || !articlePath || !filename) {
                return reply.code(400).send({ error: 'Missing file or articlePath' });
            }

            // Check edit access for the article being modified
            if (!requireAccess(request, reply, articlePath, 'edit')) {
                return;
            }

            const { safePath: resolvedArticlePath } = await resolveContentPath(contentDir, articlePath, getConfig());

            const assetsDirName = path.basename(resolvedArticlePath) + '.assets';
            const assetsDir = path.join(path.dirname(resolvedArticlePath), assetsDirName);

            await fs.mkdir(assetsDir, { recursive: true });

            const ext = path.extname(filename) || '.png';
            const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex').substring(0, 8);
            const newFilename = `${hash}${ext}`;
            const destPath = path.join(assetsDir, newFilename);

            await fs.writeFile(destPath, fileBuffer);

            const relativeAssetsDir = path.relative(contentDir, assetsDir);
            const assetSubPath = path.join(relativeAssetsDir, newFilename);

            // Return relative path for the markdown source
            return { url: assetSubPath };

        } catch (err: unknown) {
            if (isForbiddenError(err)) return reply.code(403).send({ error: 'Forbidden' });
            request.log.error(err as Error);
            return reply.code(500).send({ error: 'Upload failed' });
        }
    });
}

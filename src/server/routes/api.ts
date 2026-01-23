import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyMultipart from '@fastify/multipart';
import path from 'node:path';
import crypto from 'node:crypto';
import { type GlintConfig, type AccessLevel, getConfigPath, AVAILABLE_THEMES } from '../../config.js';
import { StorageManager } from '../../storage/index.js';
import { resolveStoragePath } from '../../storage/utils.js';
import { isForbiddenError, isNotFoundError } from '../../utils/errors.js';
import { TaskScanner } from '../../tasks/scanner.js';

import { ShareService } from '../share.js';

export async function setupAPIRoutes(
    fastify: FastifyInstance,
    contentDir: string,
    getConfig: () => GlintConfig,
    shareService: ShareService,
    taskScanner: TaskScanner,
    storage: StorageManager
) {


    // Helper to check access level and return 401/403 if insufficient
    const requireAccess = (
        request: FastifyRequest,
        reply: FastifyReply,
        urlPath: string,
        requiredLevel: AccessLevel
    ): boolean => {
        // Check share access first if sharedId is provided
        const { shareId } = (request.query || {}) as { shareId?: string };
        const bodyShareId = (request.body as any)?.shareId;
        const effectiveShareId = shareId || bodyShareId;

        const access = request.getAccess(urlPath) || (effectiveShareId ? request.getShareAccess(urlPath, effectiveShareId) : null);

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
            const { path: assetPath, context, shareId } = request.query as { path: string, context?: string, shareId?: string };

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

            const { path: safePath, stat } = await resolveStoragePath(storage, targetUrlPath, getConfig());

            if (!stat || stat.isDirectory) {
                return reply.code(404).send({ error: 'Asset not found' });
            }

            const ext = path.extname(safePath).toLowerCase();
            const contentType = IMAGE_EXTENSIONS[ext] || 'application/octet-stream';

            const fileBuffer = await storage.readBuffer(safePath);
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

            if (AVAILABLE_THEMES.includes(theme as any)) {
                const currentConfig = getConfig();
                const newConfig = { ...currentConfig, theme };

                // Get actual config path and convert to relative path for storage
                const absoluteConfigPath = await getConfigPath(contentDir);
                const relativeConfigPath = path.relative(contentDir, absoluteConfigPath);

                await storage.write(relativeConfigPath, JSON.stringify(newConfig, null, 4));

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

            const { path: safePath } = await resolveStoragePath(storage, body.path, getConfig());

            // Optimistic locking
            if (body.hash) {
                try {
                    const existingContent = await storage.read(safePath);
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

            await storage.write(safePath, body.content);
            const newHash = crypto.createHash('md5').update(body.content).digest('hex');

            if (taskScanner) await taskScanner.refresh(body.path);

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
            const normalizedPath = urlPath.replace(/^\/+/, '');

            // If path is already exact (ends with .md), try direct access first.
            // This is important for systems like TaskScanner that use exact storage paths.
            if (normalizedPath.endsWith('.md')) {
                try {
                    const content = await storage.read(normalizedPath);
                    const hash = crypto.createHash('md5').update(content).digest('hex');
                    return { content, hash, path: urlPath };
                } catch {
                    // Fall through to resolveStoragePath if direct read fails
                }
            }

            const { path: safePath } = await resolveStoragePath(storage, urlPath, getConfig());
            const content = await storage.read(safePath);
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

            const { path: resolvedArticlePath } = await resolveStoragePath(storage, articlePath, getConfig());

            const assetsDirName = path.basename(resolvedArticlePath) + '.assets';
            const assetsDir = path.posix.join(path.dirname(resolvedArticlePath), assetsDirName);

            // Storage write automatically handles parent directories in Local, and doesn't need it in Git
            // But we might want to ensure it's treated as a directory? No, just write the file.

            const ext = path.extname(filename) || '.png';
            const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex').substring(0, 8);
            const newFilename = `${hash}${ext}`;
            const destPath = path.posix.join(assetsDir, newFilename);

            await storage.writeBuffer(destPath, fileBuffer);

            // Calculate relative path for the markdown source
            // We need relative path from contentDir to assetsDir, but destPath IS that if using storage root
            // Wait, resolvedArticlePath is from storage root.
            // destPath is from storage root.
            // If the user is editing "folder/doc.md", assetsDir is "folder/doc.md.assets"
            // The image path is "folder/doc.md.assets/img.png"
            // The link in markdown should be "doc.md.assets/img.png" (relative to doc)
            // Or "/folder/doc.md.assets/img.png" (absolute)
            // Glint usually uses relative paths if possible, or absolute.
            // The previous code calculated relative path from contentDir.

            // Previous code:
            // const relativeAssetsDir = path.relative(contentDir, assetsDir);
            // const assetSubPath = path.join(relativeAssetsDir, newFilename);

            // In storage, destPath IS the path relative to root (if we assume standard mount).
            // But we want the path to insert into Markdown.

            // If we return `destPath`, it's "folder/doc.md.assets/img.png".
            // If we want it relative to the document "folder/doc.md":
            // path.relative("folder", "folder/doc.md.assets/img.png") -> "doc.md.assets/img.png"

            // Let's rely on standard absolute path behavior for now: "/folder/doc.md.assets/img.png"
            // This is safer.

            return { url: '/' + destPath };

        } catch (err: unknown) {
            if (isForbiddenError(err)) return reply.code(403).send({ error: 'Forbidden' });
            request.log.error(err as Error);
            return reply.code(500).send({ error: 'Upload failed' });
        }
    });

    // List shares for a file
    fastify.get('/api/shares', async (request, reply) => {
        const { path: filePath } = request.query as { path: string };
        if (!filePath) return reply.code(400).send({ error: 'Missing path' });

        if (!requireAccess(request, reply, filePath, 'edit')) return;

        const shares = shareService.getSharesForFile(filePath);
        return reply.send(shares);
    });

    // Create a new share
    fastify.post('/api/shares', async (request, reply) => {
        const { path: filePath, access, expiresAt, label } = request.body as {
            path: string,
            access: 'view' | 'comment' | 'edit',
            expiresAt?: number,
            label?: string
        };

        if (!filePath || !access) return reply.code(400).send({ error: 'Missing required fields' });

        if (!requireAccess(request, reply, filePath, 'edit')) return;

        const share = await shareService.createShare({
            filePath,
            access,
            expiresAt,
            label
        });

        return reply.code(201).send(share);
    });

    // Revoke a share
    fastify.delete('/api/shares/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        const share = shareService.getShare(id);

        if (!share) return reply.code(404).send({ error: 'Share not found' });

        // Must have edit access to the underlying file to revoke
        if (!requireAccess(request, reply, share.filePath, 'edit')) return;

        await shareService.revokeShare(id);
        return reply.code(204).send();
    });
}

/**
 * Git Sync Routes - Automatic pull/push for Glint content
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { type GlintConfig, type AccessLevel } from '../../config.js';
import { StorageManager } from '../../storage/index.js';

export async function setupGitRoutes(
    fastify: FastifyInstance,
    contentDir: string, // Kept for API compatibility, but unused
    getConfig: () => GlintConfig,
    storageManager: StorageManager
) {
    const requireAccess = (request: FastifyRequest, reply: FastifyReply, level: AccessLevel): boolean => {
        const access = request.getAccess('/');
        if (access === null) {
            reply.code(401).send({ error: 'Authentication required', authRequired: true });
            return false;
        }
        const hierarchy: Record<AccessLevel, number> = { view: 1, comment: 2, edit: 3 };
        if (hierarchy[access] < hierarchy[level]) {
            reply.code(403).send({ error: 'Insufficient permissions' });
            return false;
        }
        return true;
    };

    fastify.get('/api/git/status', async (request, reply) => {
        if (!requireAccess(request, reply, 'view')) return;
        try {
            return await storageManager.getGitStatus();
        } catch (error: any) {
            // If provider doesn't support git, we might want to return a specific error or just 500
            return reply.code(500).send({ error: error.message || 'Failed to get git status' });
        }
    });

    fastify.post('/api/git/sync', async (request, reply) => {
        if (!requireAccess(request, reply, 'edit')) return;
        try {
            const result = await storageManager.gitSync();
            if (!result.success) return reply.code(400).send(result);
            return result;
        } catch (error: any) {
            return reply.code(500).send({ error: 'Sync failed: ' + error.message });
        }
    });

    fastify.post('/api/git/pull', async (request, reply) => {
        if (!requireAccess(request, reply, 'edit')) return;
        try {
            const result = await storageManager.gitPull();
            return result;
        } catch (error: any) {
            return reply.code(400).send({ error: 'Pull failed: ' + error.message });
        }
    });

    fastify.post('/api/git/push', async (request, reply) => {
        if (!requireAccess(request, reply, 'edit')) return;
        try {
            const result = await storageManager.gitPush();
            return result;
        } catch (error: any) {
            return reply.code(400).send({ error: 'Push failed: ' + error.message });
        }
    });
}

/**
 * Git Sync Routes - Automatic pull/push for Glint content
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { type GlintConfig } from '../../config.js';
import { StorageManager } from '../../storage/index.js';

export async function setupGitRoutes(
    fastify: FastifyInstance,
    contentDir: string, // Kept for API compatibility, but unused
    getConfig: () => GlintConfig,
    storageManager: StorageManager
) {

    fastify.get('/api/git/status', async (request, reply) => {
        try {
            return await storageManager.getGitStatus();
        } catch (error: any) {
            return reply.code(500).send({ error: error.message || 'Failed to get git status' });
        }
    });

    fastify.post('/api/git/sync', async (request, reply) => {
        try {
            const result = await storageManager.gitSync();
            if (!result.success) return reply.code(400).send(result);
            return result;
        } catch (error: any) {
            return reply.code(500).send({ error: 'Sync failed: ' + error.message });
        }
    });

    fastify.post('/api/git/pull', async (request, reply) => {
        try {
            const result = await storageManager.gitPull();
            return result;
        } catch (error: any) {
            return reply.code(400).send({ error: 'Pull failed: ' + error.message });
        }
    });

    fastify.post('/api/git/push', async (request, reply) => {
        try {
            const result = await storageManager.gitPush();
            return result;
        } catch (error: any) {
            return reply.code(400).send({ error: 'Push failed: ' + error.message });
        }
    });
}

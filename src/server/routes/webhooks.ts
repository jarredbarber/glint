import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import { type GlintConfig } from '../../config.js';
import { StorageManager } from '../../storage/index.js';

export async function setupWebhookRoutes(
    fastify: FastifyInstance,
    storageManager: StorageManager,
    getConfig: () => GlintConfig
) {
    fastify.post('/webhooks/github', async (request, reply) => {
        const config = getConfig();
        const secret = config.github?.webhookSecret;

        if (!secret) {
            request.log.warn('GitHub webhook received but no webhookSecret configured');
            return reply.code(400).send({ error: 'Webhook secret not configured' });
        }

        // Verify HMAC signature
        const signature = request.headers['x-hub-signature-256'] as string;
        if (!signature) {
            return reply.code(401).send({ error: 'No signature provided' });
        }

        const body = JSON.stringify(request.body);
        const hmac = crypto.createHmac('sha256', secret);
        const digest = 'sha256=' + hmac.update(body).digest('hex');

        const signatureBuffer = Buffer.from(signature);
        const digestBuffer = Buffer.from(digest);

        if (signatureBuffer.length !== digestBuffer.length || !crypto.timingSafeEqual(signatureBuffer, digestBuffer)) {
            return reply.code(401).send({ error: 'Invalid signature' });
        }

        // Process push event
        const payload = request.body as any;
        const event = request.headers['x-github-event'];

        if (event === 'push') {
            const owner = payload.repository.owner.name || payload.repository.owner.login;
            const repo = payload.repository.name;

            // Extract changed files from all commits in the push
            const changedFiles = new Set<string>();
            if (payload.commits && Array.isArray(payload.commits)) {
                for (const commit of payload.commits) {
                    if (commit.added) commit.added.forEach((f: string) => changedFiles.add(f));
                    if (commit.modified) commit.modified.forEach((f: string) => changedFiles.add(f));
                    if (commit.removed) commit.removed.forEach((f: string) => changedFiles.add(f));
                }
            }

            if (changedFiles.size > 0) {
                request.log.info(`GitHub webhook: Invalidating ${changedFiles.size} files for ${owner}/${repo}`);
                storageManager.invalidateByRepo(owner, repo, Array.from(changedFiles));
            }
        }

        return { success: true };
    });
}

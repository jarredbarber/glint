import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { createServer } from '../server.js';
import { StorageManager } from '../storage/index.js';

const testDir = path.resolve('./src/tests/webhook-fixtures');

test('server: github webhooks', async (t) => {
    // Setup fixtures
    await fs.mkdir(testDir, { recursive: true });
    await fs.mkdir(path.join(testDir, '.glint'), { recursive: true });

    const webhookSecret = 'test-webhook-secret';

    await fs.writeFile(path.join(testDir, '.glint', 'config.json'), JSON.stringify({
        port: 3003,
        github: {
            webhookSecret
        },
        storage: {
            default: 'gh',
            cache: { enabled: true },
            providers: {
                gh: {
                    type: 'github',
                    owner: 'test-owner',
                    repo: 'test-repo'
                }
            },
            mounts: [
                { prefix: 'gh:', provider: 'gh' }
            ]
        }
    }));

    const { fastify, storageManager } = await createServer(testDir);

    await t.test('POST /webhooks/github fails with invalid signature', async () => {
        const payload = { repository: { owner: { login: 'test-owner' }, name: 'test-repo' }, commits: [] };
        const response = await fastify.inject({
            method: 'POST',
            url: '/webhooks/github',
            headers: {
                'x-hub-signature-256': 'sha256=invalid',
                'x-github-event': 'push'
            },
            payload
        });
        assert.strictEqual(response.statusCode, 401);
    });

    await t.test('POST /webhooks/github succeeds with valid signature and invalidates cache', async () => {
        const path = 'gh:hello.md';
        const cacheData = { html: '<h1>Cached</h1>', mtime: Date.now() };

        // Manually set cache
        storageManager.setCachedHtml(path, cacheData);
        assert.deepEqual(storageManager.getCachedHtml(path), cacheData);

        const payload = {
            repository: {
                owner: { login: 'test-owner' },
                name: 'test-repo'
            },
            commits: [
                {
                    modified: ['hello.md']
                }
            ]
        };
        const body = JSON.stringify(payload);
        const hmac = crypto.createHmac('sha256', webhookSecret);
        const digest = 'sha256=' + hmac.update(body).digest('hex');

        const response = await fastify.inject({
            method: 'POST',
            url: '/webhooks/github',
            headers: {
                'x-hub-signature-256': digest,
                'x-github-event': 'push'
            },
            payload
        });

        assert.strictEqual(response.statusCode, 200);
        const result = JSON.parse(response.payload);
        assert.strictEqual(result.success, true);

        // Verify cache is invalidated
        assert.strictEqual(storageManager.getCachedHtml(path), undefined);
    });

    // Cleanup
    await fastify.close();
    await fs.rm(testDir, { recursive: true, force: true });
});

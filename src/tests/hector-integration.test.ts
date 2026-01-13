import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createServer } from '../server.js';
import { generateServiceToken } from '../server/auth.js';

const testDir = path.resolve('./src/tests/hector-fixtures');

test('Hector integration (multi-provider API)', async (t) => {
    // Setup directories
    const primaryDir = path.join(testDir, 'primary');
    const externalDir = path.join(testDir, 'external');
    await fs.mkdir(primaryDir, { recursive: true });
    await fs.mkdir(externalDir, { recursive: true });
    await fs.mkdir(path.join(primaryDir, '.glint'), { recursive: true });

    const { token, hash } = await generateServiceToken();

    // Configure server with mounts
    const config = {
        port: 3005,
        auth: {
            enabled: true,
            serviceTokenHash: hash,
            sessionSecret: 'hector-secret'
        },
        storage: {
            default: 'local',
            providers: {
                local: { type: 'local', basePath: primaryDir },
                remote: { type: 'local', basePath: externalDir }
            },
            mounts: [
                { prefix: 'external/', provider: 'remote' }
            ]
        }
    };

    await fs.writeFile(
        path.join(primaryDir, '.glint', 'config.json'),
        JSON.stringify(config)
    );

    // Initial files
    await fs.writeFile(path.join(primaryDir, 'local-doc.md'), 'Local content');
    await fs.writeFile(path.join(externalDir, 'remote-doc.md'), 'Remote content');

    const { fastify } = await createServer(primaryDir);

    await t.test('Hector reads from default provider', async () => {
        const response = await fastify.inject({
            method: 'GET',
            url: '/api/documents/local-doc.md',
            headers: { Authorization: `Bearer ${token}` }
        });
        assert.strictEqual(response.statusCode, 200);
        const data = JSON.parse(response.payload);
        assert.strictEqual(data.markdown, 'Local content');
    });

    await t.test('Hector reads from mounted provider', async () => {
        const response = await fastify.inject({
            method: 'GET',
            url: '/api/documents/external/remote-doc.md',
            headers: { Authorization: `Bearer ${token}` }
        });
        assert.strictEqual(response.statusCode, 200);
        const data = JSON.parse(response.payload);
        assert.strictEqual(data.markdown, 'Remote content');
    });

    await t.test('Hector writes to mounted provider', async () => {
        const response = await fastify.inject({
            method: 'PUT',
            url: '/api/documents/external/new-remote.md',
            headers: { Authorization: `Bearer ${token}` },
            payload: { content: 'New remote content' }
        });
        assert.strictEqual(response.statusCode, 200);

        // Verify on disk in externalDir
        const content = await fs.readFile(path.join(externalDir, 'new-remote.md'), 'utf-8');
        assert.strictEqual(content, 'New remote content');
    });

    await t.test('Hector deletes from mounted provider', async () => {
        const response = await fastify.inject({
            method: 'DELETE',
            url: '/api/documents/external/remote-doc.md',
            headers: { Authorization: `Bearer ${token}` }
        });
        assert.strictEqual(response.statusCode, 200);

        // Verify on disk
        try {
            await fs.access(path.join(externalDir, 'remote-doc.md'));
            assert.fail('File should have been deleted from external dir');
        } catch (err: any) {
            assert.strictEqual(err.code, 'ENOENT');
        }
    });

    await t.test('Hector cannot access files outside roots (security)', async () => {
        // Try to escape using a path that stays within the route but goes up
        const response = await fastify.inject({
            method: 'GET',
            url: '/api/documents/../../etc/passwd',
            headers: { Authorization: `Bearer ${token}` }
        });

        // It should either be normalized away by Fastify/StorageManager or denied
        // 302 is redirect to login, 404 is not found, both are acceptable for an "illegal" path
        assert.notStrictEqual(response.statusCode, 200);
    });

    // Cleanup
    await fastify.close();
    await fs.rm(testDir, { recursive: true, force: true });
});

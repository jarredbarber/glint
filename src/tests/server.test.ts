import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createServer } from '../server.js';

const testDir = path.resolve('./src/tests/integration-fixtures');

test('server: integration', async (t) => {
    // Setup integration fixtures
    await fs.mkdir(testDir, { recursive: true });
    await fs.mkdir(path.join(testDir, '.glint'), { recursive: true });
    await fs.writeFile(path.join(testDir, 'README.md'), '# Home Page');
    await fs.writeFile(path.join(testDir, 'test.md'), '# Test Page');
    await fs.writeFile(path.join(testDir, '.glint', 'config.json'), JSON.stringify({
        port: 3001,
        host: '0.0.0.0',
        theme: 'nord',
        baseFile: 'README.md'
    }));

    const { fastify } = await createServer(testDir);

    await t.test('GET / returns 200 and home page content', async () => {
        const response = await fastify.inject({
            method: 'GET',
            url: '/'
        });
        assert.strictEqual(response.statusCode, 200);
        assert.ok(response.payload.includes('Home Page'));
    });

    await t.test('GET /test.md returns 200 and test page content', async () => {
        const response = await fastify.inject({
            method: 'GET',
            url: '/test.md'
        });
        assert.strictEqual(response.statusCode, 200);
        assert.ok(response.payload.includes('Test Page'));
    });

    await t.test('GET /api/tasks returns 200', async () => {
        const response = await fastify.inject({
            method: 'GET',
            url: '/api/tasks'
        });
        assert.strictEqual(response.statusCode, 200);
        const data = JSON.parse(response.payload);
        assert.ok(Array.isArray(data));
    });

    // Cleanup
    await fastify.close();
    await fs.rm(testDir, { recursive: true, force: true });
});

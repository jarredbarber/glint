import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createServer } from '../server.js';

const testDir = path.resolve('./src/tests/document-fixtures');

test('server: document api', async (t) => {
    // Setup fixtures
    await fs.mkdir(testDir, { recursive: true });
    await fs.mkdir(path.join(testDir, '.glint'), { recursive: true });

    await fs.writeFile(path.join(testDir, 'hello.md'), '# Hello World\n\nThis is a test.');

    const { fastify } = await createServer(testDir);

    await t.test('GET /api/documents/hello.md returns markdown', async () => {
        const response = await fastify.inject({
            method: 'GET',
            url: '/api/documents/hello.md',
        });
        assert.strictEqual(response.statusCode, 200);
        const data = JSON.parse(response.payload);
        assert.strictEqual(data.markdown, '# Hello World\n\nThis is a test.');
        assert.ok(data.hash);
    });

    await t.test('GET /api/documents/hello.md?render=true returns HTML', async () => {
        const response = await fastify.inject({
            method: 'GET',
            url: '/api/documents/hello.md?render=true',
        });
        assert.strictEqual(response.statusCode, 200);
        const data = JSON.parse(response.payload);
        assert.strictEqual(data.title, 'Hello World');
        assert.ok(data.html.includes('This is a test'));
        assert.ok(Array.isArray(data.headings));
    });

    await t.test('PUT /api/documents/new.md creates file', async () => {
        const response = await fastify.inject({
            method: 'PUT',
            url: '/api/documents/new.md',
            payload: {
                content: '# New File\n\nContent here',
                message: 'Create new file'
            }
        });
        assert.strictEqual(response.statusCode, 200);

        const content = await fs.readFile(path.join(testDir, 'new.md'), 'utf-8');
        assert.strictEqual(content, '# New File\n\nContent here');
    });

    await t.test('DELETE /api/documents/new.md deletes file', async () => {
        const response = await fastify.inject({
            method: 'DELETE',
            url: '/api/documents/new.md',
        });
        assert.strictEqual(response.statusCode, 200);

        try {
            await fs.access(path.join(testDir, 'new.md'));
            assert.fail('File should have been deleted');
        } catch (err: any) {
            assert.strictEqual(err.code, 'ENOENT');
        }
    });

    await t.test('POST /api/documents/render previews markdown', async () => {
        const response = await fastify.inject({
            method: 'POST',
            url: '/api/documents/render',
            payload: {
                markdown: '# Preview\n\nSome preview content'
            }
        });
        assert.strictEqual(response.statusCode, 200);
        const data = JSON.parse(response.payload);
        assert.strictEqual(data.title, 'Preview');
        assert.ok(data.html.includes('Some preview content'));
    });

    // Cleanup
    await fastify.close();
    await fs.rm(testDir, { recursive: true, force: true });
});

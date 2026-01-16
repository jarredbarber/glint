import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createServer } from '../server.js';
import { hashPassword, createSessionCookie } from '../server/auth.js';
import crypto from 'node:crypto';

const testDir = path.resolve('./src/tests/document-fixtures');

function generateTestSession(secret: string) {
    const data = { authenticated: true, createdAt: Date.now() };
    const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    return `${payload}.${signature}`;
}

test('server: document api', async (t) => {
    // Setup fixtures
    await fs.mkdir(testDir, { recursive: true });
    await fs.mkdir(path.join(testDir, '.glint'), { recursive: true });


    // Create pre-hashed password for config
    const password = 'password123';
    const passwordHash = await hashPassword(password);
    const sessionSecret = 'test-secret';

    await fs.writeFile(path.join(testDir, '.glint', 'config.json'), JSON.stringify({
        port: 3002,
        auth: {
            enabled: true,
            passwordHash,
            sessionSecret
        }
    }));

    await fs.writeFile(path.join(testDir, 'hello.md'), '# Hello World\n\nThis is a test.');

    const { fastify } = await createServer(testDir);

    await t.test('GET /api/documents/hello.md returns markdown', async () => {
        const response = await fastify.inject({
            method: 'GET',
            url: '/api/documents/hello.md',
            cookies: { glint_session: generateTestSession(sessionSecret) }
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
            cookies: { glint_session: generateTestSession(sessionSecret) }
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
            cookies: { glint_session: generateTestSession(sessionSecret) },
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
            cookies: { glint_session: generateTestSession(sessionSecret) }
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
            cookies: { glint_session: generateTestSession(sessionSecret) },
            payload: {
                markdown: '# Preview\n\nSome preview content'
            }
        });
        assert.strictEqual(response.statusCode, 200);
        const data = JSON.parse(response.payload);
        assert.strictEqual(data.title, 'Preview');
        assert.ok(data.html.includes('Some preview content'));
    });

    await t.test('GET /api/documents/hello.md fails with invalid token', async () => {
        const response = await fastify.inject({
            method: 'GET',
            url: '/api/documents/hello.md',
            cookies: {
                glint_session: 'invalid-token'
            }
        });
        assert.strictEqual(response.statusCode, 401);
    });

    // Cleanup
    await fastify.close();
    await fs.rm(testDir, { recursive: true, force: true });
});

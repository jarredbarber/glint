import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { resolveContentPath } from '../utils/fs-utils.js';
import { ForbiddenError, NotFoundError } from '../utils/errors.js';
import { GlintConfig } from '../config.js';

const mockConfig: GlintConfig = {
    port: 3000,
    host: 'localhost',
    theme: 'nord',
    baseFile: 'README.md',
    'latex-macros': {}
} as any;

const contentDir = path.resolve('./src/tests/fixtures');

test('fs-utils: resolveContentPath', async (t) => {
    // Setup fixture directory
    await fs.mkdir(contentDir, { recursive: true });
    await fs.writeFile(path.join(contentDir, 'README.md'), '# Test content');
    await fs.writeFile(path.join(contentDir, 'hello.md'), '# Hello');
    await fs.mkdir(path.join(contentDir, 'subdir'), { recursive: true });
    await fs.writeFile(path.join(contentDir, 'subdir', 'README.md'), '# Subdir index');

    await t.test('resolves root index', async () => {
        const resolved = await resolveContentPath(contentDir, '/', mockConfig);
        assert.strictEqual(resolved.safePath, path.join(contentDir, 'README.md'));
        assert.strictEqual(resolved.isMarkdown, true);
    });

    await t.test('resolves file without extension', async () => {
        const resolved = await resolveContentPath(contentDir, '/hello', mockConfig);
        assert.strictEqual(resolved.safePath, path.join(contentDir, 'hello.md'));
    });

    await t.test('resolves file in subdirectory', async () => {
        const resolved = await resolveContentPath(contentDir, '/subdir', mockConfig);
        assert.strictEqual(resolved.safePath, path.join(contentDir, 'subdir', 'README.md'));
    });

    await t.test('prevents directory traversal', async () => {
        await assert.rejects(
            resolveContentPath(contentDir, '../../package.json', mockConfig),
            (err: any) => err instanceof ForbiddenError
        );
    });

    await t.test('throws NotFoundError when allowMissing is false', async () => {
        await assert.rejects(
            resolveContentPath(contentDir, '/missing-file', mockConfig, false),
            (err: any) => err instanceof NotFoundError
        );
    });

    // Cleanup
    await fs.rm(contentDir, { recursive: true, force: true });
});

test('errors: type guards', (t) => {
    const forbidden = new ForbiddenError();
    const notFound = new NotFoundError();
    const standard = new Error();

    assert.strictEqual(forbidden.name, 'ForbiddenError');
    assert.strictEqual(notFound.name, 'NotFoundError');
});

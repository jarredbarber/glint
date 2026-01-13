import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { StorageManager } from '../storage/index.js';
import { GlintConfig } from '../config.js';

const testDir = path.resolve('./src/tests/storage-fixtures');

test('StorageManager integration', async (t) => {
    // Setup fixtures
    const primaryDir = path.join(testDir, 'primary');
    const secondaryDir = path.join(testDir, 'secondary');

    await fs.mkdir(primaryDir, { recursive: true });
    await fs.mkdir(secondaryDir, { recursive: true });

    const config: GlintConfig = {
        port: 3000,
        host: '0.0.0.0',
        theme: 'nord',
        baseFile: 'README.md',
        storage: {
            default: 'local',
            providers: {
                local: { type: 'local', basePath: primaryDir },
                second: { type: 'local', basePath: secondaryDir }
            },
            mounts: [
                { prefix: 'docs/', provider: 'second' },
                { prefix: 'docs/special/', provider: 'local' }
            ],
            cache: {
                enabled: true,
                ttl: 300000,
                maxSize: 100 * 1024 * 1024
            }
        }
    };

    const storage = new StorageManager(config, primaryDir);

    await t.test('resolves paths to correct providers', async () => {
        // Default provider (primaryDir)
        await storage.write('root.md', 'root content');
        const rootContent = await fs.readFile(path.join(primaryDir, 'root.md'), 'utf-8');
        assert.strictEqual(rootContent, 'root content');

        // Mounted provider (secondaryDir)
        await storage.write('docs/hello.md', 'hello content');
        const helloContent = await fs.readFile(path.join(secondaryDir, 'hello.md'), 'utf-8');
        assert.strictEqual(helloContent, 'hello content');

        // Longest prefix match (docs/special/ -> back to primaryDir)
        await storage.write('docs/special/item.md', 'special content');
        const itemContent = await fs.readFile(path.join(primaryDir, 'item.md'), 'utf-8');
        assert.strictEqual(itemContent, 'special content');
    });

    await t.test('handles cross-provider moves', async () => {
        await storage.write('root-move.md', 'move me');
        assert.ok(await storage.exists('root-move.md'));

        await storage.move('root-move.md', 'docs/moved.md');

        assert.ok(!await storage.exists('root-move.md'));
        assert.ok(await storage.exists('docs/moved.md'));

        const movedContent = await storage.read('docs/moved.md');
        assert.strictEqual(movedContent, 'move me');

        // Verify it actually moved between directories
        const rawContent = await fs.readFile(path.join(secondaryDir, 'moved.md'), 'utf-8');
        assert.strictEqual(rawContent, 'move me');
    });

    await t.test('unified cache invalidation', async () => {
        const cacheKey = 'docs/cache.md';
        await storage.write(cacheKey, 'v1');

        // Manually populate cache since we're testing StorageManager's cache API
        storage.setCachedHtml(cacheKey, { html: '<html>v1</html>', mtime: Date.now() });

        assert.ok(storage.getCachedHtml(cacheKey));

        // Write should invalidate
        await storage.write(cacheKey, 'v2');
        assert.strictEqual(storage.getCachedHtml(cacheKey), undefined);

        // Move should invalidate both
        await storage.write('from.md', 'content');
        storage.setCachedHtml('from.md', { html: 'from', mtime: 1 });
        storage.setCachedHtml('docs/to.md', { html: 'to', mtime: 1 });

        await storage.move('from.md', 'docs/to.md');
        assert.strictEqual(storage.getCachedHtml('from.md'), undefined);
        assert.strictEqual(storage.getCachedHtml('docs/to.md'), undefined);
    });

    await t.test('list handles mounts', async () => {
        // Root list should see files in primaryDir
        await storage.write('a.md', 'a');
        const rootFiles = await storage.list('');
        assert.ok(rootFiles.some(f => f.name === 'a.md'));

        // docs/ list should see files in secondaryDir
        await storage.write('docs/b.md', 'b');
        const docsFiles = await storage.list('docs/');
        assert.ok(docsFiles.some(f => f.name === 'b.md'));
    });

    // Cleanup
    await fs.rm(testDir, { recursive: true, force: true });
});

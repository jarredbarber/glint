import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { JournalScanner } from '../journal/scanner.js';
import { StorageManager } from '../storage/index.js';
import { GlintConfig } from '../config.js';

const testDir = path.resolve('./src/tests/journal-test-data');

const mockConfig: GlintConfig = {
    port: 3000,
    host: 'localhost',
    theme: 'nord',
    baseFile: 'README.md',
    headless: false,
    storage: {
        default: 'local',
        providers: {
            local: { type: 'local', basePath: testDir }
        },
        mounts: [],
        cache: { enabled: false, ttl: 0, maxSize: 0 }
    }
};

test('JournalScanner', async (t) => {
    // Setup test files
    await fs.mkdir(testDir, { recursive: true });
    await fs.writeFile(path.join(testDir, 'foo.md'), `---
title: Foo Note
---
# Welcome

## 2025-12-31
Content from foo on New Years Eve.

## 2025-12-30
Content from foo on Dec 30.
`);

    await fs.writeFile(path.join(testDir, 'bar.md'), `## 2025-12-31
Content from bar on New Years Eve.

## 2025-12-29
Content from bar on Dec 29.
`);

    const storage = new StorageManager(mockConfig, testDir);
    const scanner = new JournalScanner(storage);

    await t.test('scanAll aggregates sections by date', async () => {
        const groups = await scanner.scanAll();

        assert.strictEqual(groups.length, 3, 'Should have 3 unique dates');

        // Check 2025-12-31
        const nye = groups.find(g => g.date === '2025-12-31');
        assert.ok(nye);
        assert.strictEqual(nye.sections.length, 2);
        assert.ok(nye.sections.some(s => s.file === 'foo.md' && s.fileTitle === 'Foo Note'));
        assert.ok(nye.sections.some(s => s.file === 'bar.md' && s.fileTitle === 'bar.md'));
        assert.ok(nye.sections.find(s => s.file === 'foo.md')!.content.includes('Content from foo'));

        // Check order (descending)
        assert.strictEqual(groups[0].date, '2025-12-31');
        assert.strictEqual(groups[1].date, '2025-12-30');
        assert.strictEqual(groups[2].date, '2025-12-29');
    });

    // Cleanup
    await fs.rm(testDir, { recursive: true, force: true });
});

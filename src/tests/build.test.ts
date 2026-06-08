// src/tests/build.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildSite } from '../build.js';

async function makeFixture(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'glint-fixture-'));
    await fs.writeFile(path.join(dir, 'README.md'), '# Home\n\nSee [[notes/first]].\n');
    await fs.mkdir(path.join(dir, 'notes'), { recursive: true });
    await fs.writeFile(
        path.join(dir, 'notes', 'first.md'),
        '# First\n\nMath $x^2$ and an image:\n\n![pic](first.md.assets/p.png)\n'
    );
    await fs.mkdir(path.join(dir, 'notes', 'first.md.assets'), { recursive: true });
    await fs.writeFile(path.join(dir, 'notes', 'first.md.assets', 'p.png'), 'PNGDATA');
    return dir;
}

test('builds directory-per-page output with rewritten links and copied assets', async () => {
    const contentDir = await makeFixture();
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'glint-out-'));

    const result = await buildSite({ contentDir, outDir });
    assert.equal(result.failures.length, 0, JSON.stringify(result.failures));
    assert.equal(result.pages, 2);

    // Directory-per-page layout
    const home = await fs.readFile(path.join(outDir, 'README', 'index.html'), 'utf8');
    const first = await fs.readFile(path.join(outDir, 'notes', 'first', 'index.html'), 'utf8');
    await fs.access(path.join(outDir, 'index.html')); // baseFile copy

    // Wiki link rewritten to directory-per-page
    assert.match(home, /href="\/notes\/first\/"/);

    // No server-only URLs leak into output
    assert.ok(!first.includes('/api/'), 'no /api/ in output');
    assert.ok(!/href="\/f\//.test(first), 'no /f/ links in output');

    // Image rewritten + asset copied
    assert.match(first, /src="\/notes\/first\.md\.assets\/p\.png"/);
    await fs.access(path.join(outDir, 'notes', 'first.md.assets', 'p.png'));

    // Render path intact (KaTeX) and read-only bundles only
    assert.ok(first.includes('katex'), 'katex output present');
    assert.ok(!first.includes('editor.bundle.js'), 'editor bundle dropped');
    assert.ok(first.includes('outline.bundle.js'), 'outline bundle kept');

    await fs.rm(contentDir, { recursive: true, force: true });
    await fs.rm(outDir, { recursive: true, force: true });
});

test('refuses to build when outDir equals contentDir', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'glint-guard-'));
    await fs.writeFile(path.join(dir, 'README.md'), '# x\n');
    await assert.rejects(
        () => buildSite({ contentDir: dir, outDir: dir }),
        /Refusing to build/
    );
    await fs.rm(dir, { recursive: true, force: true });
});

test('refuses to build when outDir is an ancestor of contentDir', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'glint-guard-'));
    const child = path.join(parent, 'wiki');
    await fs.mkdir(child, { recursive: true });
    await fs.writeFile(path.join(child, 'README.md'), '# x\n');
    await assert.rejects(
        () => buildSite({ contentDir: child, outDir: parent }),
        /Refusing to build/
    );
    await fs.rm(parent, { recursive: true, force: true });
});

test('refuses to build into the home directory', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'glint-guard-'));
    await fs.writeFile(path.join(dir, 'README.md'), '# x\n');
    await assert.rejects(
        () => buildSite({ contentDir: dir, outDir: os.homedir() }),
        /Refusing to build/
    );
    await fs.rm(dir, { recursive: true, force: true });
});

test('allows building into a subdirectory of the content dir', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'glint-guard-'));
    await fs.writeFile(path.join(dir, 'README.md'), '# x\n');
    const out = path.join(dir, 'dist');
    const result = await buildSite({ contentDir: dir, outDir: out });
    assert.equal(result.failures.length, 0, JSON.stringify(result.failures));
    assert.ok(result.pages >= 1);
    await fs.rm(dir, { recursive: true, force: true });
});

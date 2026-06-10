// src/tests/build.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildSite } from '../build.js';
import { shareSlug } from '../share-slug.js';

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

test('--inline-fonts rewrites katex css woff2 urls to data: URIs', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'glint-inline-'));
    await fs.writeFile(path.join(dir, 'README.md'), '# x\n\n$$\\sum_i i$$\n');
    const out = path.join(dir, 'dist');

    await buildSite({ contentDir: dir, outDir: out, inlineFonts: true });
    const css = await fs.readFile(path.join(out, 'assets', 'katex', 'katex.min.css'), 'utf8');
    assert.ok(css.includes('url(data:font/woff2;base64,'), 'woff2 inlined as data URI');
    assert.ok(!/url\(fonts\/KaTeX_[\w-]+\.woff2\)/.test(css), 'no relative woff2 urls remain');

    await fs.rm(dir, { recursive: true, force: true });
});

test('without --inline-fonts the katex css keeps relative font urls', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'glint-noinline-'));
    await fs.writeFile(path.join(dir, 'README.md'), '# x\n');
    const out = path.join(dir, 'dist');

    await buildSite({ contentDir: dir, outDir: out });
    const css = await fs.readFile(path.join(out, 'assets', 'katex', 'katex.min.css'), 'utf8');
    assert.ok(/url\(fonts\/KaTeX_[\w-]+\.woff2\)/.test(css), 'relative woff2 urls present');
    assert.ok(!css.includes('data:font/woff2'), 'no data URIs without the flag');

    await fs.rm(dir, { recursive: true, force: true });
});

test('--katex-cdn points the katex stylesheet at the CDN', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'glint-cdn-'));
    await fs.writeFile(path.join(dir, 'README.md'), '# x\n\n$$\\sum_i i$$\n');
    const out = path.join(dir, 'dist');

    await buildSite({ contentDir: dir, outDir: out, katexCdn: true });
    const html = await fs.readFile(path.join(out, 'README', 'index.html'), 'utf8');
    assert.match(html, /href="https:\/\/cdn\.jsdelivr\.net\/npm\/katex@[\d.]+\/dist\/katex\.min\.css"/);
    assert.ok(!html.includes('/assets/katex/katex.min.css'), 'self-hosted katex link replaced');

    await fs.rm(dir, { recursive: true, force: true });
});

test('emits a standalone share page with stripped links and relative assets', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'glint-share-'));
    await fs.mkdir(path.join(dir, 'notes', 'first.md.assets'), { recursive: true });
    await fs.writeFile(path.join(dir, 'notes', 'first.md.assets', 'p.png'), 'PNGDATA');
    await fs.writeFile(
        path.join(dir, 'notes', 'first.md'),
        '---\nshare: true\n---\n# First\n\n![pic](first.md.assets/p.png)\n\nlink to [Second](second.md)\n'
    );
    await fs.writeFile(path.join(dir, 'notes', 'second.md'), '# Second\n');

    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'glint-out-'));
    await buildSite({ contentDir: dir, outDir });

    const slug = shareSlug('notes/first.md');
    const shareHtml = await fs.readFile(
        path.join(outDir, 'share', slug, 'index.html'),
        'utf8'
    );
    assert.ok(!shareHtml.includes('class="file-tree"'), 'no file tree');
    assert.ok(!shareHtml.includes('href="/notes/second/"'), 'internal link stripped');
    assert.ok(!shareHtml.includes('href="second.md"'), 'relative md link stripped too');
    assert.ok(shareHtml.includes('Second'), 'link text kept');
    assert.ok(shareHtml.includes('src="first.md.assets/p.png"'), 'relative asset');
    await fs.access(path.join(outDir, 'share', slug, 'first.md.assets', 'p.png'));

    // Chrome (CSS/JS) is referenced relative to the share page so it loads from
    // the share root's own assets/ copy wherever the dir is hosted.
    assert.ok(shareHtml.includes('href="../assets/layout.css"'), 'relative css');
    assert.ok(shareHtml.includes('src="../assets/outline.bundle.js"'), 'relative js');
    assert.ok(!/(?:href|src)="\/assets\//.test(shareHtml), 'no absolute /assets/ refs');
    await fs.access(path.join(outDir, 'share', 'assets', 'layout.css'));

    // No glint branding on the share page.
    assert.ok(!shareHtml.includes('logo.png'), 'no logo');
    assert.ok(!/alt="glint"/.test(shareHtml), 'no glint mention');
});

test('does not emit a share page for an unshared file', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'glint-noshare-'));
    await fs.writeFile(path.join(dir, 'plain.md'), '# Plain\n');
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'glint-out-'));
    await buildSite({ contentDir: dir, outDir });
    await assert.rejects(fs.access(path.join(outDir, 'share')));
});

test('--shared-out emits shares to a separate, self-contained dir', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'glint-so-content-'));
    await fs.writeFile(
        path.join(dir, 'doc.md'),
        '---\nshare: true\n---\n# Doc\n\n$x^2$\n'
    );
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'glint-so-out-'));
    const sharedOut = await fs.mkdtemp(path.join(os.tmpdir(), 'glint-so-share-'));

    await buildSite({ contentDir: dir, outDir, sharedOut });

    const slug = shareSlug('doc.md');
    await fs.access(path.join(sharedOut, slug, 'index.html'));
    await fs.access(path.join(sharedOut, 'assets', 'katex', 'katex.min.css'));
    await assert.rejects(fs.access(path.join(outDir, 'share')));
});

test('--shared-out share pages keep relative assets even with --prefix', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'glint-sop-content-'));
    await fs.writeFile(path.join(dir, 'doc.md'), '---\nshare: true\n---\n# Doc\n');
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'glint-sop-out-'));
    const sharedOut = await fs.mkdtemp(path.join(os.tmpdir(), 'glint-sop-share-'));

    await buildSite({ contentDir: dir, outDir, sharedOut, prefix: '/wiki' });

    const slug = shareSlug('doc.md');
    const shareHtml = await fs.readFile(path.join(sharedOut, slug, 'index.html'), 'utf8');
    // The prefix is for the main wiki; a self-contained share page must not pick
    // it up, or its CSS/JS would point at a /wiki/assets/ path the share dir lacks.
    assert.ok(shareHtml.includes('href="../assets/layout.css"'), 'relative css, no prefix');
    assert.ok(!shareHtml.includes('/wiki/assets/'), 'no prefixed asset paths');
});

test('--shared-out that contains the output dir is rejected', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'glint-soguard-content-'));
    await fs.writeFile(path.join(dir, 'doc.md'), '---\nshare: true\n---\n# Doc\n');
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'glint-soguard-'));
    const outDir = path.join(parent, 'build');
    await assert.rejects(
        buildSite({ contentDir: dir, outDir, sharedOut: parent }),
        /Refusing to use .* as --shared-out/
    );
});

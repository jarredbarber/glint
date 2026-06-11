import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripScripts, inlineStylesheets, inlineImages } from '../render.js';

test('stripScripts removes inline <script>...</script> blocks', () => {
    const html = '<p>hi</p><script>alert(1)</script><p>bye</p>';
    assert.equal(stripScripts(html), '<p>hi</p><p>bye</p>');
});

test('stripScripts removes external <script src> tags', () => {
    const html = '<body><script src="/assets/outline.bundle.js"></script></body>';
    assert.equal(stripScripts(html), '<body></body>');
});

test('stripScripts removes multiline script blocks', () => {
    const html = '<head>\n<script>\nconst x = 1;\nfoo();\n</script>\n</head>';
    assert.equal(stripScripts(html), '<head>\n\n</head>');
});

test('inlineStylesheets replaces a known stylesheet link with an inline style block', () => {
    const html = '<link rel="stylesheet" href="/assets/layout.css">';
    const css = new Map([['/assets/layout.css', 'body{color:red}']]);
    assert.equal(inlineStylesheets(html, css), '<style>body{color:red}</style>');
});

test('inlineStylesheets preserves links not present in the map (e.g. CDN)', () => {
    const html = '<link rel="stylesheet" href="https://cdn.example/katex.min.css">';
    assert.equal(inlineStylesheets(html, new Map()), html);
});

test('inlineStylesheets handles the id attribute on the theme link', () => {
    const html = '<link rel="stylesheet" href="/assets/themes/default.css" id="theme-stylesheet">';
    const css = new Map([['/assets/themes/default.css', '.t{}']]);
    assert.equal(inlineStylesheets(html, css), '<style>.t{}</style>');
});

test('inlineImages rewrites <img src> to a data URI from the map', () => {
    const html = '<img src="/notes/p.png" alt="x">';
    const data = new Map([['/notes/p.png', 'data:image/png;base64,QUJD']]);
    assert.equal(inlineImages(html, data), '<img src="data:image/png;base64,QUJD" alt="x">');
});

test('inlineImages leaves external and unmapped images untouched', () => {
    const html = '<img src="https://example.com/a.png"><img src="/missing.png">';
    assert.equal(inlineImages(html, new Map()), html);
});

import { test as t2 } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { renderFile } from '../render.js';

async function singleFileFixture(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'glint-render-'));
    await fs.writeFile(
        path.join(dir, 'doc.md'),
        '# Title\n\nMath $x^2$ and a [[other]] wiki link.\n\n![pic](doc.md.assets/p.png)\n'
    );
    await fs.mkdir(path.join(dir, 'doc.md.assets'), { recursive: true });
    await fs.writeFile(path.join(dir, 'doc.md.assets', 'p.png'), Buffer.from('PNGBYTES'));
    return dir;
}

t2('renderFile produces a self-contained static HTML document', async () => {
    const dir = await singleFileFixture();
    const html = await renderFile({ filePath: path.join(dir, 'doc.md'), katexVersion: '0.16.9' });

    // Heading + math rendered
    assert.match(html, /Title/);
    assert.match(html, /katex/, 'math rendered via KaTeX');

    // Fully static: no scripts at all
    assert.ok(!/<script/i.test(html), 'no <script> tags');

    // Chrome CSS inlined, KaTeX from CDN
    assert.match(html, /<style>/, 'inline style block present');
    assert.ok(!/href="\/assets\//.test(html), 'no local /assets/ links remain');
    assert.match(html, /cdn\.jsdelivr\.net\/npm\/katex@0\.16\.9/, 'KaTeX CSS from CDN');

    // Image inlined as data URI (base64 of "PNGBYTES")
    assert.match(html, new RegExp('data:image/png;base64,' + Buffer.from('PNGBYTES').toString('base64')));
    assert.ok(!/doc\.md\.assets/.test(html), 'no sidecar asset path remains');

    // Wiki link is not a live internal link
    assert.ok(!/href="[^"]*other[^"]*"/.test(html), 'wiki link stripped/inert');
});

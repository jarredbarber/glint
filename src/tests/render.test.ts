import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripScripts, inlineStylesheets, inlineImages, renderMarkdown } from '../render.js';

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

test('stripScripts with keepMermaid keeps mermaid loader + init, drops the rest', () => {
    const html =
        '<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>' +
        '<script>foo();</script>' +
        '<script data-glint>mermaid.initialize({});</script>';
    const out = stripScripts(html, { keepMermaid: true });
    assert.ok(out.includes('mermaid.min.js'), 'keeps the loader');
    assert.ok(out.includes('mermaid.initialize'), 'keeps the init');
    assert.ok(!out.includes('foo()'), 'drops unrelated scripts');
});

test('stripScripts drops a user script that merely mentions mermaid/abcjs (#65)', () => {
    const html =
        '<script>var note = "mermaid and abcjs"; steal();</script>' +
        '<script src="https://evil.example/mermaid.js"></script>';
    const out = stripScripts(html, { keepMermaid: true, keepAbcjs: true });
    assert.equal(out, '', 'only data-glint scripts and exact CDN URLs survive');
});

test('stripScripts without keepMermaid removes mermaid scripts too', () => {
    const html = '<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>';
    assert.equal(stripScripts(html), '');
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

t2('renderFile keeps mermaid JS only when the page has a diagram', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'glint-mer-'));

    await fs.writeFile(path.join(dir, 'plain.md'), '# Plain\n\nNo diagram here.\n');
    const plain = await renderFile({ filePath: path.join(dir, 'plain.md'), katexVersion: '0.16.9' });
    assert.ok(!/<script/i.test(plain), 'plain page stays fully JS-free');

    await fs.writeFile(path.join(dir, 'd.md'), '# D\n\n```mermaid\ngraph TD\n  A-->B\n```\n');
    const diagram = await renderFile({ filePath: path.join(dir, 'd.md'), katexVersion: '0.16.9' });
    assert.match(diagram, /<div class="mermaid">/, 'mermaid div preserved');
    assert.match(diagram, /mermaid\.min\.js/, 'mermaid loader kept');
    assert.match(diagram, /mermaid\.initialize/, 'mermaid init kept');
    // Only mermaid JS survives — no app bundles.
    assert.ok(!/\.bundle\.js/.test(diagram), 'no app bundles kept');
});

// --- body-only fragment (VimR embedding) ---

test('body-only fragment: comment fences are ordinary code blocks', async () => {
    const out = await renderMarkdown({ markdown: '# T\n\n```comment\nme@2026-01-01:10:00 hi\n```\n', bodyOnly: true });
    assert.doesNotMatch(out, /glint-widget glint-comment/);
    assert.match(out, /language-comment/);
});

test('body-only fragment: forces Glint theme colors, no colorscheme bridge by default', async () => {
    const out = await renderMarkdown({ markdown: '# T\n\ntext\n', bodyOnly: true });
    assert.match(out, /background:var\(--bg-color\)!important/, 'forces Glint bg over the host');
    // Default theme (nord) must NOT reference the host editor variables.
    assert.ok(!/var\(--nvim-color/.test(out), 'no --nvim-* bridge under the default theme');
});

test('body-only fragment: --theme=nvim inherits the host colorscheme via the theme file', async () => {
    const out = await renderMarkdown({ markdown: '# T\n\ntext\n', bodyOnly: true, theme: 'nvim' });
    assert.match(out, /--text-color: ?var\(--nvim-color/, 'nvim theme aliases text to the host fg');
    assert.match(out, /--green: ?var\(--nvim-string-color/, 'accents borrow the host syntax colors');
    assert.match(out, /color-mix\(in srgb/, 'surfaces synthesized with color-mix');
});

test('body-only fragment: drives github-markdown Primer tokens from Glint vars (issue #17)', async () => {
    const out = await renderMarkdown({ markdown: '# T\n\ntext\n', bodyOnly: true });
    // Scoped to the host wrapper, mapping Primer tokens onto Glint's palette so
    // github-markdown renders tables/code/borders in Glint's colors.
    assert.match(out, /\.markdown-body\{[^}]*--color-canvas-default:var\(--bg-color\)/s, 'canvas → --bg-color');
    assert.match(out, /--color-fg-default:var\(--text-color\)/, 'fg → --text-color');
    assert.match(out, /--color-border-default:var\(--border-color\)/, 'border → --border-color');
});

test('body-only fragment: CDN libs are gated on content', async () => {
    const plain = await renderMarkdown({ markdown: '# T\n\ntext\n', bodyOnly: true });
    assert.ok(!/jsdelivr\.net\/npm\/(mermaid|abcjs)/.test(plain), 'no CDN libs for a plain doc');
    const diagram = await renderMarkdown({ markdown: '# T\n\n```mermaid\ngraph TD;A-->B;\n```\n', bodyOnly: true });
    assert.match(diagram, /mermaid\.min\.js/, 'mermaid loader pulled when used');
    assert.match(diagram, /mermaidInitOptions\(\)/, 'shared palette-driven init emitted');
});

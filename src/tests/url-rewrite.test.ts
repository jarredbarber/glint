import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rewriteStaticHtml, applyKatexCdn, stripInternalLinks } from '../url-rewrite.js';

test('rewrites /f/ page links with .md to directory-per-page', () => {
    assert.equal(
        rewriteStaticHtml('<a href="/f/foo/bar.md">x</a>'),
        '<a href="/foo/bar/">x</a>'
    );
});

test('rewrites extensionless /f/ page links', () => {
    assert.equal(
        rewriteStaticHtml('<a href="/f/foo/bar">x</a>'),
        '<a href="/foo/bar/">x</a>'
    );
});

test('rewrites /api/asset/resolve to mirrored static asset path', () => {
    const html = '<img src="/api/asset/resolve?path=bar.md.assets%2Fimg.png&context=foo%2Fbar.md">';
    assert.equal(
        rewriteStaticHtml(html),
        '<img src="/foo/bar.md.assets/img.png">'
    );
});

test('resolves ./ asset paths against context dir', () => {
    const html = '<img src="/api/asset/resolve?path=.%2Fpic.png&context=notes%2Fa.md">';
    assert.equal(rewriteStaticHtml(html), '<img src="/notes/pic.png">');
});

test('leaves external urls, /assets, and anchors untouched', () => {
    const html =
        '<a href="https://x.com">e</a><link href="/assets/layout.css"><a href="#L12">h</a>';
    assert.equal(rewriteStaticHtml(html), html);
});

test('strips ?raw=true query from any surviving /f/ link', () => {
    assert.equal(
        rewriteStaticHtml('<a href="/f/foo/bar.md?raw=true">r</a>'),
        '<a href="/foo/bar/">r</a>'
    );
});

test('uses absolute asset path verbatim (uploaded-image case)', () => {
    const html = '<img src="/api/asset/resolve?path=%2Ffoo%2Fbar.md.assets%2Fhash.png&context=foo%2Fbar.md">';
    assert.equal(rewriteStaticHtml(html), '<img src="/foo/bar.md.assets/hash.png">');
});

test('absolute asset path with no context still used verbatim', () => {
    const html = '<img src="/api/asset/resolve?path=%2Fimg%2Flogo.png">';
    assert.equal(rewriteStaticHtml(html), '<img src="/img/logo.png">');
});

test('applyKatexCdn swaps the self-hosted katex css for the versioned CDN url', () => {
    const html = '<link rel="stylesheet" href="/assets/katex/katex.min.css">';
    assert.equal(
        applyKatexCdn(html, '0.16.27'),
        '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.27/dist/katex.min.css">'
    );
});

test('applyKatexCdn also matches a prefixed katex href', () => {
    const html = '<link href="/wiki/assets/katex/katex.min.css">';
    assert.equal(
        applyKatexCdn(html, '0.16.27'),
        '<link href="https://cdn.jsdelivr.net/npm/katex@0.16.27/dist/katex.min.css">'
    );
});

test('applyKatexCdn leaves other stylesheet links alone', () => {
    const html = '<link href="/assets/layout.css"><link href="/assets/highlight.css">';
    assert.equal(applyKatexCdn(html, '0.16.27'), html);
});

test('strips internal page links to plain text', () => {
    const html = 'see <a href="/notes/second/">Second</a> page';
    assert.equal(stripInternalLinks(html), 'see Second page');
});

test('keeps external, anchor, and mailto links', () => {
    const html =
        '<a href="https://x.com">x</a> ' +
        '<a href="#sec">sec</a> ' +
        '<a href="//cdn.com/a">cdn</a> ' +
        '<a href="mailto:a@b.com">mail</a>';
    assert.equal(stripInternalLinks(html), html);
});

test('strips internal link that has extra attributes, keeps inner markup', () => {
    const html = '<a class="x" href="/a/b/" data-y="1">go <em>now</em></a>';
    assert.equal(stripInternalLinks(html), 'go <em>now</em>');
});

test('strips relative markdown links (not just root-relative)', () => {
    assert.equal(
        stripInternalLinks('see <a href="second.md">Second</a> and <a href="../x/y.md">Y</a>'),
        'see Second and Y'
    );
});

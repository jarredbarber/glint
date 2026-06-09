import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rewriteStaticHtml, applyPrefix } from '../url-rewrite.js';

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

test('applyPrefix prefixes root-absolute href and src', () => {
    const html = '<a href="/notes/first/">x</a><script src="/assets/router.bundle.js"></script>';
    assert.equal(
        applyPrefix(html, '/wiki'),
        '<a href="/wiki/notes/first/">x</a><script src="/wiki/assets/router.bundle.js"></script>'
    );
});

test('applyPrefix normalizes the prefix (no leading/trailing slash needed)', () => {
    assert.equal(applyPrefix('<a href="/foo/">x</a>', 'wiki'), '<a href="/wiki/foo/">x</a>');
    assert.equal(applyPrefix('<a href="/foo/">x</a>', '/wiki/'), '<a href="/wiki/foo/">x</a>');
});

test('applyPrefix rewrites the bare home link', () => {
    assert.equal(applyPrefix('<a href="/">home</a>', '/wiki'), '<a href="/wiki/">home</a>');
});

test('applyPrefix leaves external, protocol-relative, anchor, and relative urls alone', () => {
    const html =
        '<a href="https://x.com">e</a><img src="//cdn/a.png"><a href="#L1">h</a><a href="sub/page/">r</a>';
    assert.equal(applyPrefix(html, '/wiki'), html);
});

test('applyPrefix with empty prefix is a no-op', () => {
    const html = '<a href="/foo/">x</a>';
    assert.equal(applyPrefix(html, ''), html);
    assert.equal(applyPrefix(html, '/'), html);
});

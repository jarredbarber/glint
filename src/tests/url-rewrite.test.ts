import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rewriteStaticHtml } from '../url-rewrite.js';

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

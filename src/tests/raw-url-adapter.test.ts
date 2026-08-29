import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RawUrlAdapter } from '../spa/storage/raw-url.js';
import type { StorageAdapter } from '../spa/storage/types.js';
import { parseLandingUrl, parseSingleRoute } from '../spa/single-route.js';

const RAW = 'https://raw.githubusercontent.com/o/r/main/README.md';

test('landing URL routing: a raw https URL becomes a #/s/url single-file route', () => {
    assert.equal(parseLandingUrl(RAW), `#/s/url/${encodeURIComponent(RAW)}`);
    // A github.com web URL still takes the richer gh route, not the raw one.
    assert.equal(parseLandingUrl('https://github.com/o/r'), '#/gh/o/r');
});

test('parseSingleRoute decodes the url backend back to the raw address', () => {
    const p = parseSingleRoute(['url', encodeURIComponent(RAW)]);
    assert.deepEqual(p, { backend: 'url', ref: '', path: RAW });
});

test('parseSingleRoute rejects a url route without an http(s) address', () => {
    assert.throws(() => parseSingleRoute(['url', encodeURIComponent('ftp://x/y')]), /http/);
});

test('list exposes one FileMeta with the filename from the URL', async () => {
    const [file] = await new RawUrlAdapter(RAW).list();
    assert.equal(file.id, RAW);
    assert.equal(file.name, 'README.md');
    assert.equal(file.path, 'README.md');
});

test('list falls back to document.md when the URL has no wiki-file name', async () => {
    const [file] = await new RawUrlAdapter('https://example.com/api/thing?x=1').list();
    assert.equal(file.name, 'document.md');
});

test('read fetches the URL content', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
        assert.equal(url, RAW);
        return new Response('# Hello', { status: 200 });
    }) as typeof fetch;
    try {
        const { content, version } = await new RawUrlAdapter(RAW).read(RAW);
        assert.equal(content, '# Hello');
        assert.equal(version, '');
    } finally {
        globalThis.fetch = original;
    }
});

test('read throws a readable error on a failed fetch', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response('nope', { status: 404 })) as typeof fetch;
    try {
        await assert.rejects(() => new RawUrlAdapter(RAW).read(RAW), /HTTP 404/);
    } finally {
        globalThis.fetch = original;
    }
});

test('read-only: write/create/delete throw and there is no discussions capability', async () => {
    const a: StorageAdapter = new RawUrlAdapter(RAW);
    assert.deepEqual(a.capabilities!(), { canEdit: false, canComment: false });
    assert.equal(a.discussions, undefined);
    await assert.rejects(() => a.write('id', 'x', ''), /read-only/);
    await assert.rejects(() => a.create('x.md', 'x'), /read-only/);
    await assert.rejects(() => a.delete('id'), /read-only/);
});

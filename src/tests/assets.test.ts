import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isManagedSrc, resolveAssetPath, derivePastePath, shortId, ASSET_MIME_EXT, MAX_ASSET_BYTES } from '../spa/assets.js';

// shortId/derivePastePath need Web Crypto; Node exposes it globally on modern versions.

test('isManagedSrc accepts page-relative refs, rejects external/absolute/data', () => {
    assert.equal(isManagedSrc('setup.md.abcd1234.png'), true);
    assert.equal(isManagedSrc('../shared/logo.png'), true);
    assert.equal(isManagedSrc('https://x/y.png'), false);
    assert.equal(isManagedSrc('//cdn/y.png'), false);
    assert.equal(isManagedSrc('/root.png'), false);
    assert.equal(isManagedSrc('data:image/png;base64,AAAA'), false);
    assert.equal(isManagedSrc(''), false);
});

test('resolveAssetPath resolves a sibling against the page parent', () => {
    assert.equal(resolveAssetPath('guides/setup.md', 'setup.md.abcd1234.png'), 'guides/setup.md.abcd1234.png');
    assert.equal(resolveAssetPath('Home.md', 'Home.md.deadbeef.gif'), 'Home.md.deadbeef.gif');
});

test('resolveAssetPath handles ../ within the root and URI-encoding', () => {
    assert.equal(resolveAssetPath('guides/setup.md', '../shared/logo.png'), 'shared/logo.png');
    assert.equal(resolveAssetPath('a/b/page.md', '../../top.png'), 'top.png');
    assert.equal(resolveAssetPath('guides/setup.md', 'sub/pic%20one.png'), 'guides/sub/pic one.png');
});

test('resolveAssetPath rejects escapes and non-relative inputs', () => {
    assert.equal(resolveAssetPath('guides/setup.md', '../../../etc/passwd'), null);
    assert.equal(resolveAssetPath('Home.md', '../x.png'), null);       // escapes the root
    assert.equal(resolveAssetPath('Home.md', 'a\\b.png'), null);        // backslash
    assert.equal(resolveAssetPath('Home.md', '/abs.png'), null);
    assert.equal(resolveAssetPath('Home.md', 'https://x/y.png'), null);
    assert.equal(resolveAssetPath('Home.md', 'x\0.png'), null);
});

test('derivePastePath names a sibling <page>.<shortid>.<ext> and a page-relative ref', () => {
    const { assetPath, ref } = derivePastePath('guides/setup.md', 'png');
    assert.match(ref, /^setup\.md\.[0-9a-f]{8}\.png$/);
    assert.equal(assetPath, `guides/${ref}`);
    // Root page: assetPath equals the ref (no parent segment).
    const root = derivePastePath('Home.md', 'webp');
    assert.match(root.ref, /^Home\.md\.[0-9a-f]{8}\.webp$/);
    assert.equal(root.assetPath, root.ref);
});

test('shortId is 8 lowercase hex chars; the mime table and ceiling are the spec values', () => {
    assert.match(shortId(), /^[0-9a-f]{8}$/);
    assert.notEqual(shortId(), shortId());
    assert.deepEqual(ASSET_MIME_EXT, { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' });
    assert.equal(MAX_ASSET_BYTES, 5_000_000);
});

test('FakeAdapter asset store is create-only and reads back bytes', async () => {
    const { FakeAdapter } = await import('../spa/storage/fake.js');
    const a = new FakeAdapter([{ name: 'Home.md', content: '# H' }]);
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    await a.createAsset('Home.md.abcd1234.png', blob);
    const back = await a.readAsset('Home.md.abcd1234.png');
    assert.deepEqual(new Uint8Array(await back.arrayBuffer()), new Uint8Array([1, 2, 3]));
    await assert.rejects(() => a.createAsset('Home.md.abcd1234.png', blob), /already exists/);
    await assert.rejects(() => a.readAsset('missing.png'), /no such asset/);
    // Assets never appear in the Markdown listing.
    assert.deepEqual((await a.list()).map((f) => f.path), ['Home.md']);
});

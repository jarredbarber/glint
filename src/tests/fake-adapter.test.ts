import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeAdapter, ConflictError } from '../spa/storage/fake.js';

test('list + read round-trip', async () => {
    const a = new FakeAdapter([{ name: 'a.md', content: '# A' }]);
    const files = await a.list();
    assert.equal(files.length, 1);
    const { content, version } = await a.read(files[0].id);
    assert.equal(content, '# A');
    assert.ok(version);
});

test('write with current version succeeds and bumps version', async () => {
    const a = new FakeAdapter([{ name: 'a.md', content: '# A' }]);
    const [f] = await a.list();
    const { version } = await a.read(f.id);
    const res = await a.write(f.id, '# B', version);
    assert.notEqual(res.version, version);
    assert.equal((await a.read(f.id)).content, '# B');
});

test('write with stale version throws ConflictError', async () => {
    const a = new FakeAdapter([{ name: 'a.md', content: '# A' }]);
    const [f] = await a.list();
    const { version } = await a.read(f.id);
    await a.write(f.id, '# B', version);
    await assert.rejects(() => a.write(f.id, '# C', version), ConflictError);
});

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

test('preserves nested source paths while exposing a basename for wiki links', async () => {
    const [file] = await new FakeAdapter([{ name: 'Guides/Welcome.md', content: '# Welcome' }]).list();
    assert.deepEqual(file, { id: 'f1', name: 'Welcome.md', path: 'Guides/Welcome.md', version: '1' });
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

test('create returns a readable new page without overwriting existing content', async () => {
    const a = new FakeAdapter([{ name: 'Existing.md', content: '# Existing' }]);
    const created = await a.create('New.md', '# New');

    assert.equal(created.name, 'New.md');
    assert.equal((await a.read(created.id)).content, '# New');
    await assert.rejects(() => a.create('Existing.md', '# Replacement'));
    assert.equal((await a.read((await a.list()).find((f) => f.name === 'Existing.md')!.id)).content, '# Existing');
});

test('delete removes only the selected page and does not reuse its ID', async () => {
    const a = new FakeAdapter([{ name: 'Keep.md', content: '# Keep' }]);
    const removed = await a.create('Remove.md', '# Remove');
    await a.delete(removed.id);

    await assert.rejects(() => a.read(removed.id));
    assert.equal((await a.list()).map((f) => f.name).join(','), 'Keep.md');

    const later = await a.create('Later.md', '# Later');
    assert.notEqual(later.id, removed.id);
});

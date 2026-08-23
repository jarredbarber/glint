import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDiscussionAnchors } from '../spa/discussions.js';
import { FakeAdapter } from '../spa/storage/fake.js';
import { Discussion } from '../spa/storage/types.js';

function discussion(anchor: Discussion['anchor']): Discussion {
    return { id: 'd', content: 'comment', author: 'A', createdAt: '', resolved: false, anchor, replies: [] };
}

test('resolves anchors by line, unique context, then unique quote', () => {
    const base = { version: 1 as const, sourceLine: 2, quote: 'target', before: 'before', after: 'after' };
    assert.equal(resolveDiscussionAnchors('before\ntarget\nafter', [discussion(base)])[0].sourceLine, 2);
    assert.equal(resolveDiscussionAnchors('x\nbefore\ntarget\nafter', [discussion(base)])[0].sourceLine, 3);
    assert.equal(resolveDiscussionAnchors('x\ntarget\ny', [discussion(base)])[0].sourceLine, 2);
    assert.equal(resolveDiscussionAnchors('target\nx\ntarget', [discussion(base)])[0].sourceLine, null);
    assert.equal(resolveDiscussionAnchors('x', [discussion(null)])[0].sourceLine, null);
});

test('discussion operations never mutate fake Markdown bytes', async () => {
    const adapter = new FakeAdapter([{ name: 'note.md', content: '# Note' }]);
    const [file] = await adapter.list();
    const before = await adapter.read(file.id);
    await adapter.discussions!.create(file.id, { version: 1, sourceLine: 1, quote: '# Note', before: null, after: null }, '**Markdown**');
    const created = (await adapter.discussions!.list(file.id))[0];
    await adapter.discussions!.reply(file.id, created.id, '`reply`');
    await adapter.discussions!.setResolved(file.id, created.id, true);
    assert.deepEqual(await adapter.read(file.id), before);
});

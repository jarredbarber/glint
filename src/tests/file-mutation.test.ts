import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileWrite } from '../spa/file-mutation.js';
import { FileMeta } from '../spa/storage/types.js';

test('reconcileWrite records the returned version and caches the content (#63)', () => {
    const files: FileMeta[] = [{ id: 'a.md', name: 'a.md', path: 'a.md', version: 'v1' }];
    const cache = new Map<string, string>([['a.md', 'old']]);
    const meta = reconcileWrite(files, cache, { id: 'a.md', content: 'new', version: 'v2' });
    assert.equal(meta?.version, 'v2');
    assert.equal(files[0].version, 'v2', 'FileMeta version updated in place');
    assert.equal(cache.get('a.md'), 'new', 'cache holds the written content');
});

test('reconcileWrite still caches content when the id is unknown (#63)', () => {
    const files: FileMeta[] = [];
    const cache = new Map<string, string>();
    const meta = reconcileWrite(files, cache, { id: 'x.md', content: 'body', version: 'v9' });
    assert.equal(meta, undefined);
    assert.equal(cache.get('x.md'), 'body');
});

test('a second mutation via the reconciled version is not a stale conflict (#63)', () => {
    // Simulates the task/section flow: write returns v2, we reconcile, and the
    // next write reads that fresh version off FileMeta.
    const files: FileMeta[] = [{ id: 'a.md', name: 'a.md', path: 'a.md', version: 'v1' }];
    const cache = new Map<string, string>();
    reconcileWrite(files, cache, { id: 'a.md', content: 'one', version: 'v2' });
    const versionForNextWrite = files.find((f) => f.id === 'a.md')!.version;
    assert.equal(versionForNextWrite, 'v2', 'next write uses the reconciled version, not v1');
});

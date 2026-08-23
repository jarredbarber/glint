import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFileTree } from '../spa/file-tree.js';

const file = (id: string, path: string) => ({ id, name: path.split('/').at(-1)!, path, version: '1' });

test('builds a deterministic nested tree from source-relative paths', () => {
    const tree = buildFileTree([
        file('b', 'notes/drafts/Second.md'),
        file('c', 'Home.md'),
        file('a', 'notes/First.md'),
        file('d', 'archive/Old.md'),
    ]);

    assert.deepEqual(tree, [
        {
            kind: 'folder', name: 'archive', path: 'archive', children: [
                { kind: 'file', name: 'Old.md', file: file('d', 'archive/Old.md') },
            ],
        },
        {
            kind: 'folder', name: 'notes', path: 'notes', children: [
                { kind: 'folder', name: 'drafts', path: 'notes/drafts', children: [
                    { kind: 'file', name: 'Second.md', file: file('b', 'notes/drafts/Second.md') },
                ] },
                { kind: 'file', name: 'First.md', file: file('a', 'notes/First.md') },
            ],
        },
        { kind: 'file', name: 'Home.md', file: file('c', 'Home.md') },
    ]);
});

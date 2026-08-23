import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWikiLink } from '../spa/wiki-links.js';

const files = [
    { id: '1', name: 'Getting Started.md', path: 'Getting Started.md', version: '1' },
    { id: '2', name: 'notes.md', path: 'sub/notes.md', version: '1' },
];

test('resolves by basename without extension, case-insensitive', () => {
    assert.equal(resolveWikiLink('getting started', files)?.id, '1');
    assert.equal(resolveWikiLink('Notes', files)?.id, '2');
    assert.equal(resolveWikiLink('notes.md', files)?.id, '2');
});

test('returns null for unknown link', () => {
    assert.equal(resolveWikiLink('missing', files), null);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePageName } from '../spa/wiki-links.js';

test('normalizes a standalone Markdown page name', () => {
    assert.equal(normalizePageName(' Notes '), 'Notes.md');
    assert.equal(normalizePageName('Notes.MD'), 'Notes.md');
    assert.equal(normalizePageName('Résumé'), 'Résumé.md');
});

test('rejects empty, reserved, and folder page names', () => {
    for (const name of ['', '.md', '..', 'notes/child', 'notes\\child', 'notes#draft', 'CON']) {
        assert.equal(normalizePageName(name), null, name);
    }
});

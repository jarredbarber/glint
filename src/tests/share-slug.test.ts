import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shareSlug } from '../share-slug.js';

test('shareSlug is deterministic for the same path', () => {
    assert.equal(shareSlug('notes/first.md'), shareSlug('notes/first.md'));
});

test('shareSlug differs across paths', () => {
    assert.notEqual(shareSlug('notes/first.md'), shareSlug('notes/second.md'));
});

test('shareSlug is short and URL-safe (hex)', () => {
    const slug = shareSlug('notes/first.md');
    assert.match(slug, /^[0-9a-f]{12}$/);
});

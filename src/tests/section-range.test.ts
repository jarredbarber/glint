import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sectionRangeFromLines } from '../spa/editor/section-range.js';

test('mid-doc section ends at next same-or-shallower section', () => {
    const r = sectionRangeFromLines(10, [25, 40], 100);
    assert.deepEqual(r, { startLine: 10, endLine: 25 });
});

test('last section runs to EOF', () => {
    const r = sectionRangeFromLines(40, [], 100);
    assert.deepEqual(r, { startLine: 40, endLine: 100 });
});

test('ignores later lines that precede startLine', () => {
    const r = sectionRangeFromLines(40, [10, 55], 100);
    assert.deepEqual(r, { startLine: 40, endLine: 55 });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSingleRoute, buildShareRoute } from '../spa/single-route.js';

test('parseSingleRoute reads gh owner/repo/path; no @ref means auto-detect', () => {
    assert.deepEqual(parseSingleRoute(['gh', 'jarredbarber', 'glint', 'docs', 'spa-setup.md']),
        { backend: 'gh', owner: 'jarredbarber', repo: 'glint', ref: '', path: 'docs/spa-setup.md' });
});

test('parseSingleRoute honors an explicit @ref', () => {
    assert.equal(parseSingleRoute(['gh', 'o', 'r', 'a', 'b.md@dev']).ref, 'dev');
    assert.equal(parseSingleRoute(['gh', 'o', 'r', 'a', 'b.md@dev']).path, 'a/b.md');
});

test('parseSingleRoute needs a file path', () => {
    assert.throws(() => parseSingleRoute(['gh', 'o', 'r']), /owner\/repo\/path/);
});

test('parseSingleRoute rejects backends without URL file identity', () => {
    assert.throws(() => parseSingleRoute(['local', 'x']), /not supported/);
    assert.throws(() => parseSingleRoute(['drive', 'folderId']), /not supported/);
});

test('buildShareRoute round-trips through parseSingleRoute', () => {
    // normalizeProjectRoute puts @ref on a trailing segment (here, empty root -> /@main).
    const route = buildShareRoute('#/gh/jarredbarber/glint/@main', 'docs/spa-setup.md');
    assert.equal(route, '#/s/gh/jarredbarber/glint/docs/spa-setup.md');
    const rest = route!.replace(/^#\/s\//, '').split('/');
    assert.equal(parseSingleRoute(rest).path, 'docs/spa-setup.md');
});

test('buildShareRoute prepends the project source root and keeps non-main ref', () => {
    // Project rooted at docs/ on branch dev; page path is source-root relative.
    assert.equal(buildShareRoute('#/gh/o/r/docs@dev', 'guide/intro.md'),
        '#/s/gh/o/r/docs/guide/intro.md@dev');
});

test('buildShareRoute returns null for backends with no shareable URL', () => {
    assert.equal(buildShareRoute('#/local', 'Home.md'), null);
    assert.equal(buildShareRoute('#/drive/folderId', 'Home.md'), null);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSingleRoute, buildShareRoute, parseGhRoute, parseLandingUrl } from '../spa/single-route.js';

test('parseGhRoute: bare owner/repo is a project on the default branch', () => {
    assert.deepEqual(parseGhRoute(['o', 'r']), { owner: 'o', repo: 'r', ref: '', path: '', mode: 'tree' });
});

test('parseGhRoute: tree marker carries ref + subtree path', () => {
    assert.deepEqual(parseGhRoute(['o', 'r', 'tree', 'dev', 'docs', 'guide']),
        { owner: 'o', repo: 'r', ref: 'dev', path: 'docs/guide', mode: 'tree' });
});

test('parseGhRoute: blob marker is a single file and triggers file mode', () => {
    assert.deepEqual(parseGhRoute(['o', 'r', 'blob', 'main', 'demo.md']),
        { owner: 'o', repo: 'r', ref: 'main', path: 'demo.md', mode: 'blob' });
});

test('parseGhRoute: legacy owner/repo/path@ref still parses as a project', () => {
    assert.deepEqual(parseGhRoute(['o', 'r', 'docs', 'a.md@dev']),
        { owner: 'o', repo: 'r', ref: 'dev', path: 'docs/a.md', mode: 'tree' });
});

test('parseGhRoute: blob without a file path is rejected', () => {
    assert.throws(() => parseGhRoute(['o', 'r', 'blob', 'main']), /file path/);
});

test('parseSingleRoute reads gh owner/repo/path; no @ref means auto-detect', () => {
    assert.deepEqual(parseSingleRoute(['gh', 'jarredbarber', 'glint', 'docs', 'spa-setup.md']),
        { backend: 'gh', owner: 'jarredbarber', repo: 'glint', ref: '', path: 'docs/spa-setup.md' });
});

test('parseSingleRoute honors an explicit @ref', () => {
    assert.equal(parseSingleRoute(['gh', 'o', 'r', 'a', 'b.md@dev']).ref, 'dev');
    assert.equal(parseSingleRoute(['gh', 'o', 'r', 'a', 'b.md@dev']).path, 'a/b.md');
});

test('parseSingleRoute reads a drive file id', () => {
    assert.deepEqual(parseSingleRoute(['drive', 'FILEID']), { backend: 'drive', ref: '', path: 'FILEID' });
});

test('parseSingleRoute needs a file path', () => {
    assert.throws(() => parseSingleRoute(['gh', 'o', 'r']), /owner\/repo\/path/);
});

test('parseSingleRoute rejects backends without URL file identity', () => {
    assert.throws(() => parseSingleRoute(['local', 'x']), /not supported/);
});

test('buildShareRoute builds the gh blob form and round-trips through parseGhRoute', () => {
    const route = buildShareRoute('#/gh/jarredbarber/glint/@main', 'docs/spa-setup.md');
    assert.equal(route, '#/gh/jarredbarber/glint/blob/main/docs/spa-setup.md');
    const rest = route!.replace(/^#\//, '').split('/').slice(1);
    assert.equal(parseGhRoute(rest).path, 'docs/spa-setup.md');
    assert.equal(parseGhRoute(rest).mode, 'blob');
});

test('buildShareRoute prepends the project source root and prefers the resolved ref', () => {
    // Project rooted at docs/ on branch dev; page path is source-root relative.
    assert.equal(buildShareRoute('#/gh/o/r/docs@dev', 'guide/intro.md'),
        '#/gh/o/r/blob/dev/docs/guide/intro.md');
    // A resolved default branch (auto-detect) overrides the implicit route ref.
    assert.equal(buildShareRoute('#/gh/o/r', 'Home.md', 'master'),
        '#/gh/o/r/blob/master/Home.md');
});

test('buildShareRoute returns null for backends with no shareable URL', () => {
    assert.equal(buildShareRoute('#/local', 'Home.md'), null);
    assert.equal(buildShareRoute('#/drive/folderId', 'Home.md'), null);
});

test('parseLandingUrl detects a github blob URL as a single file', () => {
    assert.equal(parseLandingUrl('https://github.com/jarredbarber/chromedown/blob/main/demo.md'),
        '#/gh/jarredbarber/chromedown/blob/main/demo.md');
});

test('parseLandingUrl detects a github tree URL as a project subtree', () => {
    assert.equal(parseLandingUrl('https://github.com/o/r/tree/dev/docs'), '#/gh/o/r/tree/dev/docs');
});

test('parseLandingUrl detects a bare github repo URL', () => {
    assert.equal(parseLandingUrl('github.com/o/r'), '#/gh/o/r');
    assert.equal(parseLandingUrl('https://github.com/o/r.git'), '#/gh/o/r');
});

test('parseLandingUrl detects Drive folder and file URLs', () => {
    assert.equal(parseLandingUrl('https://drive.google.com/drive/folders/ABC123'), '#/drive/ABC123');
    assert.equal(parseLandingUrl('https://drive.google.com/file/d/XYZ789/view'), '#/s/drive/XYZ789');
});

test('parseLandingUrl accepts short forms and rejects noise', () => {
    assert.equal(parseLandingUrl('owner/repo/blob/main/file.md'), '#/gh/owner/repo/blob/main/file.md');
    assert.equal(parseLandingUrl('owner/repo'), '#/gh/owner/repo');
    assert.equal(parseLandingUrl('just-one-word'), null);
    assert.equal(parseLandingUrl('   '), null);
});

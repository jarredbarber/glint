import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesWikiSearch } from '../spa/wiki-links.js';

test('matches a query against a page title or body case-insensitively', () => {
    assert.equal(matchesWikiSearch('roadmap', 'Roadmap.md', ''), true);
    assert.equal(matchesWikiSearch('kaTeX', 'Math.md', 'Rendered with KaTeX.'), true);
    assert.equal(matchesWikiSearch('missing', 'Roadmap.md', 'Plans'), false);
});

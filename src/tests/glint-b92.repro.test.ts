import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown } from '../markdown.js';

test('glint-b92 reproduction: YAML frontmatter with colons', async (t) => {
    await t.test('handles colon in title value', () => {
        const content = `---
title: Space: The final frontier
---
Content`;
        const result = parseMarkdown(content);
        // The issue says it "breaks". Let's see what result.title and result.frontmatter.title are.
        assert.equal(result.title, 'Space: The final frontier');
        assert.equal(result.frontmatter.title, 'Space: The final frontier');
    });

    await t.test('handles multi-line values with colons if they were to happen', () => {
        const content = `---
title: "Space: The final frontier"
description: "A: B"
---
Content`;
        const result = parseMarkdown(content);
        assert.equal(result.title, 'Space: The final frontier');
    });

    await t.test('does NOT break arrays with colons', () => {
        const content = `---
tags: [type:bug, area:ui]
---
Content`;
        const result = parseMarkdown(content);
        // If the regex is too aggressive, it will turn this into tags: "[type:bug, area:ui]"
        // which makes it a string instead of an array.
        assert.ok(Array.isArray(result.frontmatter.tags), 'tags should be an array');
        assert.deepEqual(result.frontmatter.tags, ['type:bug', 'area:ui']);
    });
});

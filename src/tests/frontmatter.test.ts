import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown } from '../markdown.js';

test('frontmatter parsing', async (t) => {
    await t.test('parses simple frontmatter', () => {
        const content = `---
title: Hello World
tags: [a, b]
---
Content`;
        const result = parseMarkdown(content);
        assert.equal(result.title, 'Hello World');
        assert.deepEqual(result.frontmatter.tags, ['a', 'b']);
    });

    await t.test('parses frontmatter with colons in values', () => {
        const content = `---
title: Project: Zero
description: The specific: problem
---
Content`;
        const result = parseMarkdown(content);
        assert.equal(result.title, 'Project: Zero');
        assert.equal(result.frontmatter.description, 'The specific: problem');
    });

    await t.test('parses frontmatter with quoted colons', () => {
        const content = `---
title: "Project: Zero"
---
Content`;
        const result = parseMarkdown(content);
        assert.equal(result.title, 'Project: Zero');
    });
});

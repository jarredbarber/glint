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

    // #52: gray-matter throws in the browser bundle (no Buffer). The fallback must
    // still strip the frontmatter block so it never leaks into rendered output.
    await t.test('strips frontmatter even when the YAML parser throws', () => {
        const original = (globalThis as { Buffer?: unknown }).Buffer;
        delete (globalThis as { Buffer?: unknown }).Buffer;
        try {
            const result = parseMarkdown(`---
title: Leaky
author: Nobody
---

# Head

Body.`);
            assert.ok(!result.content.includes('title: Leaky'), 'frontmatter must not leak into content');
            assert.ok(!result.content.includes('author'), 'frontmatter must not leak into content');
            assert.ok(result.content.includes('Body.'), 'body must survive');
        } finally {
            (globalThis as { Buffer?: unknown }).Buffer = original;
        }
    });
});

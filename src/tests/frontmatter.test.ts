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
        // #67: title comes from the first `# ` heading, not frontmatter. No H1 here.
        assert.equal(result.title, null);
        assert.equal(result.frontmatter.title, 'Hello World');
        assert.deepEqual(result.frontmatter.tags, ['a', 'b']);
    });

    await t.test('parses frontmatter with colons in values', () => {
        const content = `---
title: Project: Zero
description: The specific: problem
---
Content`;
        const result = parseMarkdown(content);
        assert.equal(result.frontmatter.title, 'Project: Zero');
        assert.equal(result.frontmatter.description, 'The specific: problem');
    });

    await t.test('parses frontmatter with quoted colons', () => {
        const content = `---
title: "Project: Zero"
---
Content`;
        const result = parseMarkdown(content);
        assert.equal(result.frontmatter.title, 'Project: Zero');
    });

    // #65: single-line display math must not shift the line count, or every
    // source-line-based edit after it targets the wrong line.
    await t.test('display-math fix preserves line count and the math source line', () => {
        const md = `Intro.

$$ x = y $$

After.`;
        const result = parseMarkdown(md, false);
        const lines = result.content.split('\n');
        assert.equal(lines.length, md.split('\n').length, 'total line count unchanged');
        // "After." keeps its original line index (4, zero-based).
        assert.equal(lines[4], 'After.');
        // Math content stays on its original line, delimiters on the blanks.
        assert.equal(lines[1], '$$');
        assert.equal(lines[2], 'x = y');
        assert.equal(lines[3], '$$');
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
            // #67: the browser fallback still exposes frontmatter values.
            assert.equal(result.frontmatter.title, 'Leaky');
            assert.equal(result.frontmatter.author, 'Nobody');
            assert.equal(result.title, 'Head', 'title still comes from the H1');
        } finally {
            (globalThis as { Buffer?: unknown }).Buffer = original;
        }
    });
});

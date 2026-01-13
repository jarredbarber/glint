
import { test } from 'node:test';
import assert from 'node:assert';
import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeStringify from 'rehype-stringify';
import { rehypeExtractHeadings, type HeadingNode } from '../rehype-extract-headings.js';

test('rehypeExtractHeadings: extracts text correctly before autolink', async () => {
    const processor = unified()
        .use(rehypeParse, { fragment: true })
        .use(rehypeSlug)
        .use(rehypeExtractHeadings)
        .use(rehypeAutolinkHeadings, {
            behavior: 'prepend',
            properties: { className: ['heading-anchor'] },
            content: { type: 'text', value: '#' }
        })
        .use(rehypeStringify);

    const html = '<h2 id="hello">Hello World</h2>';
    const file = await processor.process(html);

    const headings = file.data.headings as HeadingNode[];

    assert.equal(headings.length, 1);
    assert.equal(headings[0].text, 'Hello World');
    assert.equal(headings[0].id, 'hello');
});

test('rehypeExtractHeadings: extracts text correctly if order is swapped (simulation of bug)', async () => {
    // If autolink runs FIRST, we expect the hash to be in the text
    const processor = unified()
        .use(rehypeParse, { fragment: true })
        .use(rehypeSlug)
        .use(rehypeAutolinkHeadings, {
            behavior: 'prepend',
            properties: { className: ['heading-anchor'] },
            content: { type: 'text', value: '#' }
        })
        .use(rehypeExtractHeadings)
        .use(rehypeStringify);

    const html = '<h2 id="hello">Hello World</h2>';
    const file = await processor.process(html);

    const headings = file.data.headings as HeadingNode[];

    assert.equal(headings.length, 1);
    // This asserts what we think happens if order is wrong
    assert.equal(headings[0].text, '#Hello World');
});

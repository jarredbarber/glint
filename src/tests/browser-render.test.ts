import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../browser.js';

test('renderMarkdown produces HTML with math, code, and tasks', async () => {
    const html = await renderMarkdown(`# Hello

## Code and Math

Inline math: $E=mc^2$

\`\`\`js
console.log(1);
\`\`\`

- [ ] open task
- [x] done task
`);

    assert.ok(html.includes('<h2'), 'has subheading');
    assert.ok(html.includes('katex'), 'katex math rendered');
    assert.ok(html.includes('hljs'), 'syntax highlighting applied');
    assert.ok(html.includes('task') || html.includes('data-state') || html.includes('glint-task'), 'task widget rendered');
});

test('renderMarkdown with custom macros', async () => {
    const html = await renderMarkdown('$$\\R$$', { macros: { R: '\\mathbb{R}' } });
    assert.ok(html.includes('katex'), 'macro-using math rendered');
});

test('defaultMeta backfills author/updated from the backend (#87)', async () => {
    const meta = { author: 'Ada Lovelace', updated: '2026-08-01T00:00:00Z' };

    // Frontmatter absent → backend values fill in.
    const backfilled = await renderMarkdown('# Doc\n\nBody.', { defaultMeta: meta });
    assert.ok(backfilled.includes('by Ada Lovelace'), 'backend author used');
    assert.ok(backfilled.includes('Updated'), 'backend modifiedTime used');

    // Frontmatter present → it wins over the backend.
    const overridden = await renderMarkdown('---\nauthor: Grace Hopper\n---\n\n# Doc\n\nBody.', { defaultMeta: meta });
    assert.ok(overridden.includes('by Grace Hopper'), 'frontmatter author wins');
    assert.ok(!overridden.includes('by Ada Lovelace'), 'backend author suppressed');

    // Backend absent → neither field rendered.
    const bare = await renderMarkdown('# Doc\n\nBody.');
    assert.ok(!bare.includes('by '), 'no author line without a source');
    assert.ok(!bare.includes('Updated'), 'no updated line without a source');
});

test('SPA render keeps relative image src, never the phantom asset API (#65)', async () => {
    const html = await renderMarkdown('![pic](images/cat.png)');
    assert.ok(!html.includes('/api/asset/resolve'), 'no dead resolver URL in static SPA output');
    assert.ok(html.includes('src="images/cat.png"'), 'relative src preserved');
});

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

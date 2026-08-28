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

test('renderMarkdown renders inline KaTeX in the doc title (#132)', async () => {
    const html = await renderMarkdown('# The $L^2$ norm\n\nBody.');
    const title = html.slice(html.indexOf('glint-doc-title'), html.indexOf('</h1>'));
    assert.ok(title.includes('katex'), 'title math rendered');
    assert.ok(!title.includes('$L^2$'), 'raw math delimiters gone from title');
    assert.ok(title.startsWith('glint-doc-title">The '), 'surrounding title text preserved');
});

test('renderMarkdown title math honors frontmatter macros (#132)', async () => {
    const html = await renderMarkdown('---\nlatex-macros:\n  R: \\mathbb{R}\n---\n# Over $\\R$\n\nBody.');
    const title = html.slice(html.indexOf('glint-doc-title'), html.indexOf('</h1>'));
    assert.ok(title.includes('mathbb'), 'title macro expanded');
});

test('renderMarkdown with custom macros', async () => {
    const html = await renderMarkdown('$$\\R$$', { macros: { R: '\\mathbb{R}' } });
    assert.ok(html.includes('katex'), 'macro-using math rendered');
});

test('renderMarkdown reads KaTeX macros from frontmatter (#107)', async () => {
    const html = await renderMarkdown(`---
latex-macros:
  R: \\mathbb{R}
---
$$
\\R
$$`);
    assert.ok(html.includes('mathbb'), 'frontmatter macro rendered');
    assert.ok(!html.includes('latex-macros'), 'configuration is not rendered as metadata');
});

test('display equation numbering is opt-in (#106)', async () => {
    const plain = await renderMarkdown('$$\nx = 1\n$$');
    assert.ok(!plain.includes('class="tag"'), 'plain display equation stays unnumbered');

    const manual = await renderMarkdown(String.raw`$$
x = 1 \tag{A}
$$`);
    assert.ok(manual.includes('class="tag"'), '\\tag adds a manual equation number');

    const automatic = await renderMarkdown(String.raw`$$
\begin{align}
x &= 1 \\
y &= 2
\end{align}
$$`);
    assert.ok(automatic.includes('class="eqn-num"'), 'unstarred align numbers its rows');
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import rehypeRaw from 'rehype-raw';
import { remarkGlintWidgets } from '../remark-glint-widgets.js';

// Helper to process markdown with widgets
async function processMarkdown(content: string) {
    const file = await unified()
        .use(remarkParse)
        .use(remarkGlintWidgets)
        .use(remarkRehype, { allowDangerousHtml: true })
        .use(rehypeRaw)
        .use(rehypeStringify)
        .process(content);
    return String(file);
}

test('widgets: tasks', async (t) => {
    await t.test('renders open task', async () => {
        const html = await processMarkdown('- [ ] Open task');
        assert.ok(html.includes('class="glint-task"'));
        assert.ok(html.includes('data-state="open"'));
        assert.ok(html.includes('Open task'));
    });

    await t.test('renders completed task', async () => {
        const html = await processMarkdown('- [x] Done task');
        assert.ok(html.includes('data-state="done"'));
    });

    await t.test('renders in-progress task', async () => {
        const html = await processMarkdown('- [/] WIP task');
        assert.ok(html.includes('data-state="progress"'));
    });

    await t.test('renders task metadata', async () => {
        const html = await processMarkdown('- [ ] Task with meta (due:2026-01-01)');
        assert.ok(html.includes('class="meta-due"'));
        assert.ok(html.includes('2026-01-01'));
    });
});

test('comment fences remain ordinary Markdown code blocks', async () => {
    const html = await processMarkdown('```comment\nuser@2026-01-01: Hello\n```');
    assert.doesNotMatch(html, /glint-comment/);
    assert.match(html, /<code class="language-comment">/);
});

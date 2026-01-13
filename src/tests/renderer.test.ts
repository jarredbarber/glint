import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDate, renderMetadata } from '../renderer/metadata.js';
import { renderBreadcrumbs } from '../renderer/breadcrumbs.js';

test('renderer: metadata', (t) => {
    t.test('formatDate', () => {
        assert.strictEqual(formatDate(null), null);
        const formatted = formatDate('2026-01-12');
        assert.ok(formatted?.includes('January'));
        assert.ok(formatted?.includes('2026'));
    });

    t.test('renderMetadata', () => {
        const meta = renderMetadata({
            author: 'Jarred',
            date: '2026-01-12',
            tags: ['test', 'glint']
        });
        assert.ok(meta.includes('by Jarred'));
        assert.ok(meta.includes('January'));
        assert.ok(meta.includes('2026'));
        assert.ok(meta.includes('<span class="tag">test</span>'));
    });
});

test('renderer: breadcrumbs', (t) => {
    t.test('returns empty for home', () => {
        assert.strictEqual(renderBreadcrumbs('/'), '');
        assert.strictEqual(renderBreadcrumbs('/index.md'), '');
    });

    t.test('renders segments', () => {
        const html = renderBreadcrumbs('/docs/features/markdown.md');
        assert.ok(html.includes('Docs'));
        assert.ok(html.includes('Features'));
        assert.ok(html.includes('Markdown'));
        assert.ok(html.includes('href="/docs"'));
    });
});

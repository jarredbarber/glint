import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS } from '../config.js';
import { renderHtml } from '../renderer.js';

const config = { ...DEFAULTS, colorScheme: 'nord' };

test('static renderer emits article and outline without server chrome (#120)', () => {
    const out = renderHtml({
        content: '<p>hi</p>',
        title: 'Document',
        config,
        currentPath: 'notes/first.md',
        headings: [{ depth: 2, text: 'Details', id: 'details' }],
    });

    assert.match(out, /<h1>Document<\/h1>/);
    assert.match(out, /<p>hi<\/p>/);
    assert.match(out, /href="#details"/);
    assert.match(out, /data-access="view"/);
    for (const deadChrome of ['command-palette', 'lightbox-overlay', 'mobile-toggle', 'class="sidebar']) {
        assert.ok(!out.includes(deadChrome), `omits ${deadChrome}`);
    }
    assert.ok(!out.includes('.bundle.js'), 'omits legacy application bundles');
});

test('static renderer keeps the shared diagram initializer', () => {
    const out = renderHtml({
        content: '<div class="mermaid">graph TD; A-->B</div>',
        title: 'Diagram',
        config,
        currentPath: 'diagram.md',
    });

    assert.match(out, /<script data-glint>/);
    assert.match(out, /mermaid\.initialize/);
});

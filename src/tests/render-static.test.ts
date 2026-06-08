import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderScripts } from '../renderer/scripts.js';

const KEEP = ['router', 'outline', 'citations', 'lightbox', 'code-blocks', 'mobile-sidebar'];
const DROP = ['upload', 'editor', 'editor-integration', 'share', 'command-palette', 'image-resize'];

test('static mode emits only read-only bundles', () => {
    const out = renderScripts(undefined, [], true);
    for (const name of KEEP) {
        assert.ok(out.includes(`/assets/${name}.bundle.js`), `expected ${name}`);
    }
    for (const name of DROP) {
        assert.ok(!out.includes(`/assets/${name}.bundle.js`), `should drop ${name}`);
    }
});

test('non-static mode still emits the editor bundle', () => {
    const out = renderScripts(undefined, [], false);
    assert.ok(out.includes('/assets/editor.bundle.js'));
});

test('static mode keeps the inline mermaid init script', () => {
    const out = renderScripts(undefined, [], true);
    assert.ok(out.includes('mermaid.initialize'));
});

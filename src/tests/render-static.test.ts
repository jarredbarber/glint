import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderScripts } from '../renderer/scripts.js';
import { renderSidebar } from '../renderer/sidebar.js';

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

test('static mode omits the SSE hot-reload EventSource', () => {
    const out = renderScripts(undefined, [], true);
    assert.ok(!out.includes('EventSource("/events")'), 'static should not open SSE');
});

test('non-static mode keeps the SSE hot-reload EventSource', () => {
    const out = renderScripts(undefined, [], false);
    assert.ok(out.includes('EventSource("/events")'), 'serve mode keeps SSE');
});

test('theme switcher derives stylesheet from existing href (prefix-safe), not a hardcoded /assets path', () => {
    const out = renderSidebar({ fileTree: [], currentPath: 'x.md' });
    // Must reuse the already-(prefix-)rendered <link> href instead of rebuilding an absolute path.
    assert.ok(out.includes('themeLink.href.replace('), 'theme switch reuses existing href');
    assert.ok(!out.includes("'/assets/themes/'"), 'no hardcoded absolute themes path in JS');
});

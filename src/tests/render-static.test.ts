import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderScripts } from '../renderer/scripts.js';
import { renderSidebar } from '../renderer/sidebar.js';
import { renderHtml } from '../renderer.js';

const config = { colorScheme: 'nord' } as any;
const fileTree = [] as any;

// Static uses native navigation, so the SPA router is dropped too.
const KEEP = ['outline', 'citations', 'lightbox', 'code-blocks', 'mobile-sidebar'];
const DROP = ['router', 'upload', 'editor', 'editor-integration', 'command-palette', 'image-resize'];

test('static mode emits only read-only bundles', () => {
    const out = renderScripts([], true);
    for (const name of KEEP) {
        assert.ok(out.includes(`/assets/${name}.bundle.js`), `expected ${name}`);
    }
    for (const name of DROP) {
        assert.ok(!out.includes(`/assets/${name}.bundle.js`), `should drop ${name}`);
    }
});

test('non-static mode still emits the editor and router bundles', () => {
    const out = renderScripts([], false);
    assert.ok(out.includes('/assets/editor.bundle.js'));
    assert.ok(out.includes('/assets/router.bundle.js'));
});

test('static mode keeps the inline mermaid init script', () => {
    const out = renderScripts([], true);
    assert.ok(out.includes('mermaid.initialize'));
});

test('static mode omits the SSE hot-reload EventSource', () => {
    const out = renderScripts([], true);
    assert.ok(!out.includes('EventSource("/events")'), 'static should not open SSE');
});

test('non-static mode keeps the SSE hot-reload EventSource', () => {
    const out = renderScripts([], false);
    assert.ok(out.includes('EventSource("/events")'), 'serve mode keeps SSE');
});

test('standalone render hides file tree and the home branding link', () => {
    const out = renderHtml({
        content: '<p>hi</p>',
        title: 'Shared',
        config,
        fileTree,
        currentPath: 'notes/first.md',
        static: true,
        standalone: true,
    });
    assert.ok(!out.includes('class="file-tree"'), 'no file tree in standalone');
    assert.ok(!out.includes('<a href="/"'), 'no home branding link in standalone');
});

test('color scheme switcher derives stylesheet from existing href (prefix-safe), not a hardcoded /assets path', () => {
    const out = renderSidebar({ fileTree: [], currentPath: 'x.md' });
    // Must reuse the already-(prefix-)rendered <link> href instead of rebuilding an absolute path.
    assert.ok(out.includes('colorSchemeLink.href.replace('), 'color scheme switch reuses existing href');
    assert.ok(!out.includes("'/assets/color-schemes/'"), 'no hardcoded absolute color-schemes path in JS');
});

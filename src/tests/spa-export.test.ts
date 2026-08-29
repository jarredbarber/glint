import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStandaloneHtml } from '../spa/export.js';

test('standalone export embeds rendered content without external application assets', () => {
    const document = createStandaloneHtml('Notes <draft>', '<h1>Notes</h1><p>Ready to share.</p>');

    assert.match(document, /<title>Notes &lt;draft&gt;<\/title>/);
    assert.match(document, /Content-Security-Policy/);
    assert.match(document, /<style>/);
    assert.match(document, /<h1>Notes<\/h1>/);
    assert.doesNotMatch(document, /<link\s+[^>]*href=/);
    assert.doesNotMatch(document, /<script\b/);
});

test('export inlines the real theme CSS so it matches the live render (#146)', () => {
    const document = createStandaloneHtml('Math', '<span class="katex-mathml">e=mc^2</span>');
    // KaTeX CSS is inlined, so its MathML annotation is visually hidden (no plaintext twin).
    assert.match(document, /\.katex-mathml\{[^}]*(clip-path|position:absolute)/);
    // The prepended heading autolink is hidden rather than showing a literal '#'.
    assert.match(document, /\.heading-anchor\s*\{[\s\S]*?(opacity|position:\s*absolute)/);
    // Still self-contained: everything lives in the inline <style>, no external refs.
    assert.doesNotMatch(document, /<link\s+[^>]*href=/);
});

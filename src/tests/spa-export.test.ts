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

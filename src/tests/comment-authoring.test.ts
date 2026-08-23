import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendCommentBlock, appendCommentReply, formatCommentEntry } from '../spa/comment-authoring.js';

test('formats portable comment entries and appends a new comment block', () => {
    const entry = formatCommentEntry('Fake User', 'First comment', new Date('2026-08-23T12:34:00Z'));
    assert.equal(entry, 'Fake-User@2026-08-23:12:34 First comment');
    assert.equal(
        appendCommentBlock('# Notes\n', entry),
        '# Notes\n\n```comment\nFake-User@2026-08-23:12:34 First comment\n```\n',
    );
});

test('inserts a reply into the selected comment fence', () => {
    const content = '# Notes\n\n```comment\nsummary: Topic\nalice@2026-08-23:12:00 First\n```\n';
    assert.equal(
        appendCommentReply(content, 3, 'bob@2026-08-23:12:34 Reply'),
        '# Notes\n\n```comment\nsummary: Topic\nalice@2026-08-23:12:00 First\nbob@2026-08-23:12:34 Reply\n```\n',
    );
});

test('refuses replies when the rendered comment is stale', () => {
    assert.throws(() => appendCommentReply('# Notes\n', 1, 'me@2026-08-23:12:34 Reply'), /no longer exists/);
});

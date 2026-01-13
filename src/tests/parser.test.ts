import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTaskLine } from '../tasks/parser.js';

test('parser: parseTaskLine', (t) => {
    t.test('parses open task', () => {
        const result = parseTaskLine('- [ ] Simple task', 'test.md', 1);
        assert.ok(result);
        assert.strictEqual(result.state, 'open');
        assert.strictEqual(result.description, 'Simple task');
    });

    t.test('parses done task', () => {
        const result = parseTaskLine('- [x] Done task', 'test.md', 2);
        assert.ok(result);
        assert.strictEqual(result.state, 'done');
    });

    t.test('parses in-progress task', () => {
        const result = parseTaskLine('- [/] In progress task', 'test.md', 3);
        assert.ok(result);
        assert.strictEqual(result.state, 'progress');
    });

    t.test('parses task with metadata', () => {
        const result = parseTaskLine('- [ ] Task with meta (@alice #high due:2026-02-01)', 'test.md', 4);
        assert.ok(result);
        assert.strictEqual(result.description, 'Task with meta');
        assert.strictEqual(result.metadata.assignee, 'alice');
        assert.strictEqual(result.metadata.priority, 'high');
        assert.strictEqual(result.metadata.due, '2026-02-01');
    });

    t.test('ignores non-task lines', () => {
        assert.strictEqual(parseTaskLine('Just text', 'test.md', 5), null);
        assert.strictEqual(parseTaskLine('- No bracket', 'test.md', 6), null);
    });
});

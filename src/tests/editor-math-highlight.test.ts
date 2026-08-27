import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parser as baseMd } from '@lezer/markdown';
import { MathHighlight } from '../client/editor-languages.js';

const md = baseMd.configure(MathHighlight as any);

// Collect the [type, text] of every InlineMath/BlockMath node in a parse.
function mathNodes(src: string): Array<[string, string]> {
    const out: Array<[string, string]> = [];
    const tree = md.parse(src);
    tree.iterate({
        enter(node) {
            if (node.name === 'InlineMath' || node.name === 'BlockMath') {
                out.push([node.name, src.slice(node.from, node.to)]);
            }
        },
    });
    return out;
}

test('inline $..$ is highlighted', () => {
    assert.deepEqual(mathNodes('an equation $x^2 + 1$ here'), [['InlineMath', '$x^2 + 1$']]);
});

test('display $$..$$ spanning lines is highlighted', () => {
    const src = '$$\nx = 1 \\\\\ny = 2\n$$';
    assert.deepEqual(mathNodes(src), [['BlockMath', src]]);
});

test('prose dollars are left alone (pandoc spacing rule)', () => {
    assert.deepEqual(mathNodes('costs $5 to $10 total'), []);
});

test('empty and unclosed delimiters are ignored', () => {
    assert.deepEqual(mathNodes('$$ nothing closes here'), []);
    assert.deepEqual(mathNodes('a $$ b'), []);
});

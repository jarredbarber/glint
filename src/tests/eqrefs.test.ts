import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../browser.js';

test('equation labels number sequentially and refs resolve (#108)', async () => {
    const html = await renderMarkdown(`See [[#eq:mass]] and later [[#eq:energy]].

$$
E = mc^2 \\label{eq:mass}
$$

$$
K = \\tfrac12 m v^2 \\label{eq:energy}
$$
`);
    assert.ok(html.includes('<a class="glint-eqref" href="#eq-mass">(1)</a>'), 'first ref numbered and linked');
    assert.ok(html.includes('<a class="glint-eqref" href="#eq-energy">(2)</a>'), 'second ref numbered and linked');
    assert.ok(html.includes('id="eq-mass"'), 'first equation anchored');
    assert.ok(html.includes('id="eq-energy"'), 'second equation anchored');
    assert.ok(!html.includes('\\label'), '\\label stripped from rendered TeX');
});

test('forward references resolve before the equation is defined (#108)', async () => {
    const html = await renderMarkdown(`As shown in [[#eq:later]] below.

$$
a^2 + b^2 = c^2 \\label{eq:later}
$$
`);
    assert.ok(html.includes('href="#eq-later">(1)</a>'), 'forward ref resolves');
});

test('unknown equation reference renders as broken (#108)', async () => {
    const html = await renderMarkdown('See [[#eq:ghost]].');
    assert.ok(html.includes('glint-eqref broken-link'), 'missing ref marked broken');
    assert.ok(html.includes('(?)'), 'missing ref shows placeholder');
});

test('anchors track display order when some equations are unlabeled (#108)', async () => {
    const html = await renderMarkdown(`$$
x = 1
$$

$$
y = 2 \\label{eq:y}
$$
`);
    // The labeled equation is the second display block; its id must land there,
    // not on the first unlabeled one.
    const firstIdx = html.indexOf('id="eq-y"');
    const yIdx = html.indexOf('y');
    assert.ok(firstIdx !== -1, 'labeled equation anchored');
    assert.ok(firstIdx > html.indexOf('x'), 'anchor is on the second block, not the first');
});

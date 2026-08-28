import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown as renderForSpa } from '../browser.js';
import { renderMarkdown as renderPortable } from '../render.js';
import { boundedEmbedSize } from '../spa/custom-embeds.js';
import { createStandaloneHtml } from '../spa/export.js';

const activeImage = '<img src="photo.png" onerror="globalThis.pwned=true" style="position:fixed" data-glint-trusted="yes">';
const customBlock = `<custom-player>
<script>parent.postMessage({type:'custom-ran'}, '*')</script>
</custom-player>`;

test('active attributes and executable URLs are removed on every render surface', async () => {
    const markdown = `${activeImage}\n\n<a href="javascript:alert(1)" onclick="alert(2)">bad link</a>`;
    const spa = await renderForSpa(markdown);
    const full = await renderPortable({ markdown });
    const bodyOnly = await renderPortable({ markdown, bodyOnly: true });
    const exported = createStandaloneHtml('Export', spa);

    for (const [surface, html] of Object.entries({ spa, full, bodyOnly, exported })) {
        assert.doesNotMatch(html, /\sonerror=|\sonclick=|href="javascript:|style="position:fixed|data-glint-trusted=/i, surface);
    }
});

test('passive semantic HTML remains inline with bounded image presentation', async () => {
    const html = await renderForSpa(`<figure class="align-left arbitrary" style="color:red">
<img src="photo.png" alt="Photo" width="50%" height="6000">
<figcaption>A caption</figcaption>
</figure>

<details open><summary>More</summary><p><mark>Marked</mark> <kbd>⌘K</kbd> <abbr title="Hypertext">HTML</abbr></p></details>

<audio controls src="media/song.mp3"></audio>

<video controls width="640" src="https://media.example/video.mp4"></video>`);

    assert.match(html, /<figure class="align-left"/);
    assert.match(html, /<img src="photo\.png" alt="Photo" width="50%"/);
    assert.doesNotMatch(html, /height="6000"|arbitrary|style=/);
    assert.match(html, /<figcaption>A caption<\/figcaption>/);
    assert.match(html, /<details open(?:\s|>)/);
    assert.match(html, /<summary>More<\/summary>/);
    assert.match(html, /<mark>Marked<\/mark>/);
    assert.match(html, /<kbd>⌘K<\/kbd>/);
    assert.match(html, /<audio controls src="media\/song\.mp3"><\/audio>/);
    assert.match(html, /<video [^>]*src="https:\/\/media\.example\/video\.mp4"[^>]*><\/video>/);
});

test('complete custom blocks use the opaque sandbox on SPA, full, and body-only output', async () => {
    const spa = await renderForSpa(customBlock);
    assert.match(spa, /<iframe class="glint-custom-embed" sandbox="allow-scripts allow-presentation"/);
    assert.match(spa, /data-glint-embed=/);
    assert.doesNotMatch(spa, /srcdoc=|<script>parent\.postMessage/);

    for (const html of [
        await renderPortable({ markdown: customBlock }),
        await renderPortable({ markdown: customBlock, bodyOnly: true }),
    ]) {
        assert.match(html, /<iframe class="glint-custom-embed" sandbox="allow-scripts allow-presentation"/);
        assert.match(html, /srcdoc=/);
        assert.match(html, /default-src (?:'|&#x27;)none(?:'|&#x27;)/);
        assert.doesNotMatch(html, /<script>parent\.postMessage\(\{type:'custom-ran'/);
    }
});

test('author iframe srcdoc is nested inside the generated opaque frame', async () => {
    const attack = `<iframe srcdoc="<script>parent.localStorage.getItem('glint-token')</script>"></iframe>`;
    const spa = await renderForSpa(attack);
    assert.equal((spa.match(/<iframe\b/g) ?? []).length, 1);
    assert.match(spa, /sandbox="allow-scripts allow-presentation"/);
    assert.match(spa, /data-glint-embed=/);
    assert.doesNotMatch(spa, /srcdoc=|<script>/);
});

test('unknown inline and incomplete HTML is displayed literally', async () => {
    const inline = await renderForSpa('Before <custom-inline><script>bad()</script></custom-inline> after');
    assert.doesNotMatch(inline, /<custom-inline>|<script>/);
    assert.match(inline, /&#x3C;custom-inline>/);
    assert.match(inline, /&#x3C;\/custom-inline>/);

    const incomplete = await renderForSpa('<custom-block>\nNever closed');
    assert.doesNotMatch(incomplete, /<iframe|<custom-block>/);
    assert.match(incomplete, /&#x3C;custom-block>/);
});

test('author imitations cannot select trusted Mermaid, KaTeX, citation, widget, or source paths', async () => {
    const html = await renderForSpa(`<div class="mermaid glint-task" data-state="done" data-source-line="999">imitation</div>

<span class="math-inline">not math</span>

<cite class="glint-cite" data-ref="paper">not citation</cite>

\`\`\`mermaid
graph TD; A-->B
\`\`\`

Inline math: $E=mc^2$

Citation [[#ref:paper]].

## References

- [ref:paper] "A Paper" Ada (2026) https://example.com/paper

- [ ] real task`);

    assert.doesNotMatch(html, /data-source-line="999"|data-state="done"/);
    assert.match(html, /<div data-source-line="1" id="L1">imitation<\/div>/);
    assert.match(html, /class="mermaid"/);
    assert.match(html, /class="[^\"]*katex/);
    assert.match(html, /class="glint-cite"/);
    assert.match(html, /class="glint-task"/);
    assert.match(html, /data-source-line=/);
});

test('embed resize bridge accepts only bounded, secret-free messages', () => {
    assert.deepEqual(
        boundedEmbedSize({ type: 'glint-embed-resize', width: 99999, height: -50 }),
        { width: 1600, height: 96 },
    );
    assert.equal(boundedEmbedSize({ type: 'glint-embed-resize', width: 300, height: 400, token: 'secret' }), null);
    assert.equal(boundedEmbedSize({ type: 'glint-embed-resize', width: '300', height: 400 }), null);
    assert.equal(boundedEmbedSize({ type: 'other', width: 300, height: 400 }), null);
});

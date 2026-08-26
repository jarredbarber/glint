import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeAdapter } from '../spa/storage/fake.js';
import { openSectionEditor } from '../spa/editor/session.js';

// #82: an empty / section-less doc renders no .glint-section and no [data-source-line];
// getCurrentSection falls back to the wrapper, so `e` must open a whole-document editor.
class FakeElement {
    style: Record<string, string> = {};
    className = '';
    dataset: Record<string, string> = {};
    classList: string[] = [];
    textContent = '';
    parentNode: { insertBefore: () => void } | null = null;
    readonly children: FakeElement[] = [];
    appendChild(child: FakeElement): void { this.children.push(child); }
    remove(): void {}
    closest(): FakeElement | null { return null; }
    querySelectorAll(): FakeElement[] { return []; }
}

test('empty file opens a whole-document editor instead of dead-ending', async () => {
    const wrapper = new FakeElement();
    wrapper.classList = ['content-wrapper'];
    const stalePreamble = new FakeElement();      // e.g. the page source link
    wrapper.children.push(stalePreamble);

    let editorOptions: { initialValue?: string } | undefined;

    Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: {
            body: new FakeElement(),
            querySelector: () => wrapper,
            createElement: () => new FakeElement(),
        },
    });
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: {
            GlintEditor: class {
                constructor(_c: FakeElement, options: typeof editorOptions) { editorOptions = options; }
                destroy(): void {}
            },
        },
    });

    const adapter = new FakeAdapter([{ name: 'empty.md', content: '' }]);
    await openSectionEditor(adapter, 'f1', wrapper as unknown as HTMLElement);

    assert.equal(editorOptions?.initialValue, '', 'editor loads the whole (empty) document');
    assert.equal(stalePreamble.style.display, 'none', 'existing wrapper content is hidden while editing');
    assert.equal(wrapper.children.length, 2, 'the editor container is appended inside the wrapper');
});

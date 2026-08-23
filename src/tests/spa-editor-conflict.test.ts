import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeAdapter } from '../spa/storage/fake.js';
import { openSectionEditor } from '../spa/editor/session.js';

class FakeElement {
    style: Record<string, string> = {};
    className = '';
    dataset: Record<string, string> = {};
    classList: string[] = [];
    textContent = '';
    parentNode: { insertBefore: (child: FakeElement, reference: FakeElement) => void } | null = null;
    readonly children: FakeElement[] = [];

    appendChild(child: FakeElement): void {
        this.children.push(child);
    }

    remove(): void {}

    closest(_selector: string): FakeElement | null {
        return null;
    }

    querySelectorAll(_selector: string): FakeElement[] {
        return [];
    }
}

test('save conflict retains the editor buffer without reloading or alerting', async () => {
    const elements: FakeElement[] = [];
    const wrapper = new FakeElement();
    const section = new FakeElement();
    section.dataset.sectionLine = '1';
    section.parentNode = { insertBefore: () => {} };
    wrapper.querySelectorAll = () => [section];

    let editorOptions: { onSave?: (content: string) => Promise<void> } | undefined;
    let reloads = 0;
    let alerts = 0;

    Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: {
            body: wrapper,
            querySelector: () => wrapper,
            createElement: () => {
                const element = new FakeElement();
                elements.push(element);
                return element;
            },
        },
    });
    Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: { reload: () => { reloads += 1; } },
    });
    Object.defineProperty(globalThis, 'alert', {
        configurable: true,
        value: () => { alerts += 1; },
    });
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: {
            GlintEditor: class {
                constructor(_container: FakeElement, options: typeof editorOptions) {
                    editorOptions = options;
                }

                destroy(): void {}
            },
        },
    });

    const domSection = section as unknown as HTMLElement; // Test double supplies the DOM members used by the editor session.
    const adapter = new FakeAdapter([{ name: 'note.md', content: '# Remote' }]);
    await openSectionEditor(adapter, 'f1', domSection);
    await adapter.write('f1', '# Changed remotely', '1');

    const save = editorOptions?.onSave;
    assert.ok(save, 'the editor exposes its save operation');
    await save('# Local changes');

    assert.equal(reloads, 0);
    assert.equal(alerts, 0);
    assert.ok(
        elements.some((element) => element.textContent.includes('Your changes are still in the editor')),
        'a visible recovery notice explains that the buffer is still available',
    );
});

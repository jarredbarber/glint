import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSectionEditor, openSectionEditor } from '../spa/editor/session.js';
import { StorageAdapter } from '../spa/storage/types.js';

class FakeElement {
    style: Record<string, string> = {};
    className = '';
    dataset: Record<string, string> = {};
    classList: string[] = [];
    parentNode: { insertBefore: (child: FakeElement, reference: FakeElement) => void } | null = null;
    removed = false;

    remove(): void {
        this.removed = true;
    }

    closest(_selector: string): FakeElement | null {
        return null;
    }

    querySelectorAll(_selector: string): FakeElement[] {
        return [];
    }
}

test('editor opens replace unconditionally and stale opens cannot create phantom editors', async (t) => {
    const descriptors = Object.fromEntries(
        ['document', 'window', 'confirm'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
    );
    const containers: FakeElement[] = [];
    const wrapper = new FakeElement();
    const section = new FakeElement();
    section.dataset.sectionLine = '1';
    section.parentNode = { insertBefore: (container) => { containers.push(container); } };
    wrapper.querySelectorAll = () => [section];

    let confirmations = 0;
    let destroyed = 0;
    Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: {
            body: wrapper,
            querySelector: () => wrapper,
            createElement: () => new FakeElement(),
        },
    });
    Object.defineProperty(globalThis, 'confirm', {
        configurable: true,
        value: () => { confirmations += 1; return true; },
    });
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: {
            GlintEditor: class {
                constructor(_container: FakeElement, _options: unknown) {}

                destroy(): void {
                    destroyed += 1;
                }
            },
        },
    });
    t.after(() => {
        closeSectionEditor();
        for (const [name, descriptor] of Object.entries(descriptors)) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else Reflect.deleteProperty(globalThis, name);
        }
    });

    const immediateAdapter = {
        auth: async () => {},
        identity: () => ({ name: 'Fake User' }),
        list: async () => [],
        read: async () => ({ content: '# Note', version: '1' }),
        write: async () => ({ version: '2' }),
        create: async (name: string) => ({ id: name, name, path: name, version: '1' }),
        delete: async () => {},
        createAsset: async () => {},
        readAsset: async () => new Blob(),
    } satisfies StorageAdapter;
    const domSection = section as unknown as HTMLElement; // Test double supplies the DOM members used by the editor session.

    await openSectionEditor(immediateAdapter, 'note.md', domSection);
    await openSectionEditor(immediateAdapter, 'note.md', domSection);

    assert.equal(confirmations, 0);
    assert.equal(destroyed, 1);
    assert.equal(containers.length, 2);
    assert.equal(containers[0]?.removed, true);

    const pendingReads: ((value: { content: string; version: string }) => void)[] = [];
    const deferredAdapter = {
        auth: async () => {},
        identity: () => ({ name: 'Fake User' }),
        list: async () => [],
        read: () => new Promise<{ content: string; version: string }>((resolve) => { pendingReads.push(resolve); }),
        write: async () => ({ version: '2' }),
        create: async (name: string) => ({ id: name, name, path: name, version: '1' }),
        delete: async () => {},
        createAsset: async () => {},
        readAsset: async () => new Blob(),
    } satisfies StorageAdapter;

    closeSectionEditor();
    const beforeRace = containers.length;
    const firstOpen = openSectionEditor(deferredAdapter, 'note.md', domSection);
    const secondOpen = openSectionEditor(deferredAdapter, 'note.md', domSection);
    pendingReads[1]!({ content: '# Newer', version: '2' });
    await secondOpen;
    pendingReads[0]!({ content: '# Older', version: '1' });
    await firstOpen;

    assert.equal(containers.length - beforeRace, 1);
    assert.equal(section.style.display, 'none');
});

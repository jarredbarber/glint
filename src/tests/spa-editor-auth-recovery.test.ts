import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSectionEditor, openSectionEditor } from '../spa/editor/session.js';
import { StorageAdapter } from '../spa/storage/types.js';

class FakeElement {
    style: Record<string, string> = {};
    className = '';
    dataset: Record<string, string> = {};
    classList: string[] = [];
    private value = '';
    removed = false;
    parentNode: { insertBefore: (child: FakeElement, reference: FakeElement) => void } | null = null;
    readonly children: FakeElement[] = [];
    private listeners = new Map<string, () => void>();

    get textContent(): string {
        return this.value;
    }

    set textContent(value: string) {
        this.value = value;
        this.children.length = 0;
    }
    appendChild(child: FakeElement): void {
        this.children.push(child);
    }

    addEventListener(type: string, listener: () => void): void {
        this.listeners.set(type, listener);
    }

    click(): void {
        this.listeners.get('click')?.();
    }

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

function installEditorDom(t: { after: (fn: () => void) => void }) {
    const descriptors = Object.fromEntries(
        ['document', 'window', 'location', 'alert'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
    );
    const elements: FakeElement[] = [];
    const wrapper = new FakeElement();
    const section = new FakeElement();
    section.dataset.sectionLine = '1';
    section.parentNode = { insertBefore: () => {} };
    wrapper.querySelectorAll = () => [section];
    let options: { onSave: (content: string) => Promise<boolean>; initialValue: string } | undefined;
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
                constructor(_container: FakeElement, editorOptions: typeof options) {
                    options = editorOptions;
                }

                destroy(): void {}
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

    return {
        section: section as unknown as HTMLElement,
        elements,
        get options() { return options; },
        get reloads() { return reloads; },
        get alerts() { return alerts; },
    };
}

class ExpiredAuthError extends Error {
    constructor() {
        super('access token expired');
        this.name = 'AuthExpiredError';
    }
}

test('an expired-auth save silently reconnects once, retries once, then closes in place', async (t) => {
    const dom = installEditorDom(t);
    const writes: string[] = [];
    const saved: Array<[string, string]> = [];
    let silentReauths = 0;
    const adapter = {
        auth: async () => { throw new Error('interactive auth must not run'); },
        reauthenticate: async () => { silentReauths += 1; },
        identity: () => ({ name: 'Test User' }),
        list: async () => [],
        read: async () => ({ content: '# Note', version: '1' }),
        write: async (_id: string, content: string) => {
            writes.push(content);
            if (writes.length === 1) throw new ExpiredAuthError();
            return { version: '2' };
        },
        create: async (name: string) => ({ id: name, name, path: name, version: '1' }),
        delete: async () => {},
    } satisfies StorageAdapter;

    await openSectionEditor(adapter, 'note.md', dom.section, true, (id, content) => { saved.push([id, content]); });
    const ok = await dom.options?.onSave('# Edited');

    assert.equal(ok, true);
    assert.equal(silentReauths, 1);
    assert.deepEqual(writes, ['# Edited', '# Edited']);
    assert.deepEqual(saved, [['note.md', '# Edited']]);
    assert.equal(dom.reloads, 0);
    assert.equal(dom.alerts, 0);
});

test('failed silent reauthentication retains the editor and offers interactive reconnect', async (t) => {
    const dom = installEditorDom(t);
    let silentReauths = 0;
    let interactiveAuths = 0;
    const adapter = {
        auth: async () => {
            interactiveAuths += 1;
            throw new Error('interactive authentication canceled');
        },
        reauthenticate: async () => {
            silentReauths += 1;
            throw new Error('silent credentials unavailable');
        },
        identity: () => ({ name: 'Test User' }),
        list: async () => [],
        read: async () => ({ content: '# Note', version: '1' }),
        write: async () => { throw new ExpiredAuthError(); },
        create: async (name: string) => ({ id: name, name, path: name, version: '1' }),
        delete: async () => {},
    } satisfies StorageAdapter;

    await openSectionEditor(adapter, 'note.md', dom.section);
    const saved = await dom.options?.onSave('# Edited');
    const reconnect = dom.elements.find((element) => element.className === 'glint-editor-reconnect');
    const notice = dom.elements.find((element) => element.className === 'glint-editor-save-auth');

    assert.equal(saved, false);
    assert.equal(silentReauths, 1);
    assert.equal(dom.reloads, 0);
    assert.equal(dom.alerts, 0);
    assert.equal(dom.options?.initialValue, '# Note');
    assert.ok(reconnect, 'a visible reconnect control retains the open editor');
    reconnect.click();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(interactiveAuths, 1);
    assert.ok(notice?.children.includes(reconnect), 'a failed reconnect leaves the control available for another attempt');
});

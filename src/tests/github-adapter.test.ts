import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubAdapter } from '../spa/storage/github.js';

test('keeps supplied GitHub credentials in memory and reserves token entry for the in-app prompt', async (t) => {
    const descriptors = Object.fromEntries(
        ['localStorage', 'fetch', 'prompt'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
    );
    let authPrompts = 0;
    let validations = 0;
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: new Proxy({}, { get: () => { throw new Error('credentials must not use localStorage'); } }),
    });
    // The adapter must not fall back to the browser dialog any more.
    Object.defineProperty(globalThis, 'prompt', {
        configurable: true,
        value: () => { throw new Error('auth must not call window.prompt'); },
    });
    Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        value: async () => {
            validations += 1;
            return validations === 2 || validations === 3
                ? new Response('expired', { status: 401 })
                : new Response(JSON.stringify({ login: 'octocat' }));
        },
    });
    t.after(() => {
        for (const [name, descriptor] of Object.entries(descriptors)) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else Reflect.deleteProperty(globalThis, name);
        }
    });

    const authPrompt = async () => { authPrompts += 1; return { kind: 'pat' as const, token: 'replacement-token' }; };
    const adapter = new GitHubAdapter('owner', 'repo', '', 'main', undefined, 'memory-token', authPrompt) as GitHubAdapter & { reauthenticate(): Promise<void> };
    await adapter.auth();
    await assert.rejects(adapter.reauthenticate(), /authentication expired/);
    assert.equal(authPrompts, 0);

    await adapter.auth();
    assert.equal(authPrompts, 1);
});

test('caches GitHub file content until a directory refresh reports a new blob SHA', async (t) => {
    const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
    let fileReads = 0;
    let listVersion = 'sha-1';
    Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        value: async (url: string) => {
            if (url.includes('?ref=main') && !url.includes('note.md')) {
                return new Response(JSON.stringify([{
                    type: 'file', name: 'note.md', path: 'note.md', sha: listVersion,
                }]));
            }
            fileReads += 1;
            const content = listVersion === 'sha-1' ? 'first' : 'second';
            return new Response(JSON.stringify({
                content: btoa(content),
                sha: listVersion,
            }));
        },
    });
    t.after(() => {
        if (fetchDescriptor) Object.defineProperty(globalThis, 'fetch', fetchDescriptor);
        else Reflect.deleteProperty(globalThis, 'fetch');
    });

    const adapter = new GitHubAdapter('owner', 'repo', '', 'main');
    await adapter.list();
    assert.deepEqual(await adapter.read('note.md'), { content: 'first', version: 'sha-1' });
    assert.deepEqual(await adapter.read('note.md'), { content: 'first', version: 'sha-1' });
    assert.equal(fileReads, 1);

    listVersion = 'sha-2';
    await adapter.list();
    assert.deepEqual(await adapter.read('note.md'), { content: 'second', version: 'sha-2' });
    assert.equal(fileReads, 2);
});


test('recursively lists repository folders using source-relative file IDs', async (t) => {
    const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
    Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        value: async (url: string) => {
            if (url.includes('/contents/docs/notes?')) {
                return new Response(JSON.stringify([{
                    type: 'file', name: 'Draft.md', path: 'docs/notes/Draft.md', sha: 'draft-sha',
                }]));
            }
            return new Response(JSON.stringify([
                { type: 'dir', name: 'notes', path: 'docs/notes', sha: 'dir-sha' },
                { type: 'file', name: 'Home.md', path: 'docs/Home.md', sha: 'home-sha' },
            ]));
        },
    });
    t.after(() => {
        if (fetchDescriptor) Object.defineProperty(globalThis, 'fetch', fetchDescriptor);
        else Reflect.deleteProperty(globalThis, 'fetch');
    });

    const adapter = new GitHubAdapter('owner', 'repo', 'docs', 'main');
    assert.deepEqual(await adapter.list(), [
        { id: 'Home.md', name: 'Home.md', path: 'Home.md', version: 'home-sha' },
        { id: 'notes/Draft.md', name: 'Draft.md', path: 'notes/Draft.md', version: 'draft-sha' },
    ]);
});
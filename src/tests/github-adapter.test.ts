import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubAdapter } from '../spa/storage/github.js';

test('silently validates a cached GitHub token and reserves PAT entry for interactive auth', async (t) => {
    const descriptors = Object.fromEntries(
        ['localStorage', 'fetch', 'prompt'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
    );
    const stored: Record<string, string> = { 'glint-gh-token': 'cached-token' };
    let prompts = 0;
    let validations = 0;
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => stored[key] ?? null,
            setItem: (key: string, value: string) => { stored[key] = value; },
        },
    });
    Object.defineProperty(globalThis, 'prompt', {
        configurable: true,
        value: () => { prompts += 1; return 'replacement-token'; },
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

    const adapter = new GitHubAdapter('owner', 'repo', '', 'main') as GitHubAdapter & { reauthenticate(): Promise<void> };
    await adapter.auth();
    await assert.rejects(adapter.reauthenticate(), /authentication expired/);
    assert.equal(prompts, 0);

    await adapter.auth();
    assert.equal(prompts, 1);
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

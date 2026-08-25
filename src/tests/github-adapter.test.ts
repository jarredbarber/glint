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
        value: async (url: string) => {
            // The repo-permissions probe (#59) is not a credential validation; keep it
            // out of the 401 sequence the prompt-reuse assertion depends on.
            if (!url.endsWith('/user')) return new Response(JSON.stringify({ permissions: { push: true } }));
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
            if (url.includes('/git/trees/')) {
                return new Response(JSON.stringify({ truncated: false, tree: [
                    { type: 'blob', path: 'note.md', sha: listVersion },
                ] }));
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


test('lists the whole repo with one Git Trees call, filtered to the subtree (#66)', async (t) => {
    const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
    let treeCalls = 0, contentsCalls = 0;
    Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        value: async (url: string) => {
            if (url.includes('/git/trees/')) {
                treeCalls += 1;
                return new Response(JSON.stringify({ truncated: false, tree: [
                    { type: 'tree', path: 'docs', sha: 'd0' },
                    { type: 'tree', path: 'docs/notes', sha: 'dir-sha' },
                    { type: 'blob', path: 'docs/Home.md', sha: 'home-sha' },
                    { type: 'blob', path: 'docs/notes/Draft.md', sha: 'draft-sha' },
                    { type: 'blob', path: 'docs/logo.png', sha: 'png' },       // non-markdown, skipped
                    { type: 'blob', path: 'other/Outside.md', sha: 'skip' },   // outside subtree, skipped
                ] }));
            }
            if (url.includes('/contents/')) contentsCalls += 1;
            return new Response(JSON.stringify([]));
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
    assert.equal(treeCalls, 1, 'exactly one tree request');
    assert.equal(contentsCalls, 0, 'no per-directory contents walk');
});

test('falls back to the contents walk when the tree is truncated (#66)', async (t) => {
    const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
    Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        value: async (url: string) => {
            if (url.includes('/git/trees/')) {
                return new Response(JSON.stringify({ truncated: true, tree: [] }));
            }
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
test('auto-detects the repo default branch when no ref is given (#64)', async (t) => {
    const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
    const refs: string[] = [];
    Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        value: async (url: string) => {
            if (url.endsWith('/user')) return new Response(JSON.stringify({ login: 'octocat' }));
            // The repo probe carries the default branch; a repo on `master`, not `main`.
            if (url.endsWith('/repos/owner/repo')) return new Response(JSON.stringify({ permissions: { push: true }, default_branch: 'master' }));
            const m = url.match(/\/git\/trees\/([^?]+)/);
            if (m) refs.push(decodeURIComponent(m[1]));
            return new Response(JSON.stringify({ truncated: false, tree: [{ type: 'blob', path: 'Home.md', sha: 's1' }] }));
        },
    });
    t.after(() => {
        if (fetchDescriptor) Object.defineProperty(globalThis, 'fetch', fetchDescriptor);
        else Reflect.deleteProperty(globalThis, 'fetch');
    });
    // Empty ref = auto-detect.
    const adapter = new GitHubAdapter('owner', 'repo', '', '', undefined, 'tok');
    await adapter.auth();
    await adapter.list();
    assert.deepEqual(refs, ['master']);
});

test('an explicit ref is not overridden by the default branch (#64)', async (t) => {
    const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
    const refs: string[] = [];
    Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        value: async (url: string) => {
            if (url.endsWith('/user')) return new Response(JSON.stringify({ login: 'octocat' }));
            if (url.endsWith('/repos/owner/repo')) return new Response(JSON.stringify({ permissions: { push: true }, default_branch: 'master' }));
            const m = url.match(/\/git\/trees\/([^?]+)/);
            if (m) refs.push(decodeURIComponent(m[1]));
            return new Response(JSON.stringify({ truncated: false, tree: [] }));
        },
    });
    t.after(() => {
        if (fetchDescriptor) Object.defineProperty(globalThis, 'fetch', fetchDescriptor);
        else Reflect.deleteProperty(globalThis, 'fetch');
    });
    const adapter = new GitHubAdapter('owner', 'repo', '', 'develop', undefined, 'tok');
    await adapter.auth();
    await adapter.list();
    assert.deepEqual(refs, ['develop']);
});

test('reports read-only when the token lacks push on the repo (#59)', async (t) => {
    const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
    t.after(() => {
        if (fetchDescriptor) Object.defineProperty(globalThis, 'fetch', fetchDescriptor);
        else Reflect.deleteProperty(globalThis, 'fetch');
    });
    const withPush = async (push: boolean) => {
        Object.defineProperty(globalThis, 'fetch', {
            configurable: true,
            value: async (url: string) =>
                url.endsWith('/user')
                    ? new Response(JSON.stringify({ login: 'octocat' }))
                    : new Response(JSON.stringify({ permissions: { push } })),
        });
        const adapter = new GitHubAdapter('owner', 'repo', '', 'main', undefined, 'tok');
        await adapter.auth();
        return adapter.capabilities!();
    };
    assert.deepEqual(await withPush(false), { canEdit: false, canComment: false });
    assert.deepEqual(await withPush(true), { canEdit: true, canComment: false });
});

test('reuses a valid cached token from localStorage without prompting (#53)', async (t) => {
    const descriptors = Object.fromEntries(
        ['localStorage', 'fetch'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
    );
    const store = new Map<string, string>([['glint.github.token', 'cached-token']]);
    let authPrompts = 0;
    let sawToken: string | null = null;
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => { store.set(k, v); },
            removeItem: (k: string) => { store.delete(k); },
        },
    });
    Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        value: async (_url: string, opts: RequestInit) => {
            sawToken = String((opts.headers as Record<string, string>).Authorization);
            return new Response(JSON.stringify({ login: 'octocat' }));
        },
    });
    t.after(() => {
        for (const [name, descriptor] of Object.entries(descriptors)) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else Reflect.deleteProperty(globalThis, name);
        }
    });

    const authPrompt = async () => { authPrompts += 1; return null; };
    // No initialToken: the adapter must recover the token from localStorage.
    const adapter = new GitHubAdapter('owner', 'repo', '', 'main', undefined, null, authPrompt);
    await adapter.auth();
    assert.equal(authPrompts, 0);
    assert.equal(sawToken, 'Bearer cached-token');
});

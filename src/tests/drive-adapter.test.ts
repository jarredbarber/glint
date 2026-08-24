import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DriveAdapter } from '../spa/storage/drive.js';

test('lists every Drive API page before returning Markdown files', async () => {
    const adapter = new DriveAdapter('folder', 'client');
    const paths: string[] = [];
    const pages = [
        { files: [{ id: 'first', name: 'First.md', mimeType: 'text/markdown', modifiedTime: '1' }], nextPageToken: 'next-page' },
        { files: [{ id: 'second', name: 'Second.md', mimeType: 'text/markdown', modifiedTime: '2' }] },
    ];
    Object.defineProperty(adapter, 'api', {
        value: async (path: string) => {
            paths.push(path);
            return new Response(JSON.stringify(pages.shift()));
        },
    });

    const files = await adapter.list();

    assert.deepEqual(files.map((file) => file.name), ['First.md', 'Second.md']);
    assert.match(paths[1]!, /pageToken=next-page/);
});

test('recursively lists Drive folders with source-relative paths', async () => {
    const adapter = new DriveAdapter('root', 'client');
    const responses = new Map([
        ['root', { files: [
            { id: 'notes', name: 'Notes', mimeType: 'application/vnd.google-apps.folder' },
            { id: 'home', name: 'Home.md', mimeType: 'text/markdown', modifiedTime: '1' },
        ] }],
        ['notes', { files: [
            { id: 'draft', name: 'Draft.md', mimeType: 'text/markdown', modifiedTime: '2' },
        ] }],
    ]);
    Object.defineProperty(adapter, 'api', {
        value: async (path: string) => new Response(JSON.stringify(
            responses.get(decodeURIComponent(path).match(/'([^']+)'/)?.[1] ?? ''),
        )),
    });

    assert.deepEqual(await adapter.list(), [
        { id: 'home', name: 'Home.md', path: 'Home.md', version: '1' },
        { id: 'draft', name: 'Draft.md', path: 'Notes/Draft.md', version: '2' },
    ]);
});

test('resolving a discussion posts a reply action, not a PATCH on resolved', async () => {
    const adapter = new DriveAdapter('folder', 'client');
    const calls: { path: string; init?: RequestInit }[] = [];
    Object.defineProperty(adapter, 'api', {
        value: async (path: string, init?: RequestInit) => {
            calls.push({ path, init });
            return new Response(JSON.stringify({ id: 'reply1', action: 'resolve' }));
        },
    });

    await adapter.discussions!.setResolved('file1', 'comment1', true);

    assert.equal(calls.length, 1);
    assert.match(calls[0]!.path, /\/comments\/comment1\/replies/);
    assert.equal(calls[0]!.init?.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0]!.init!.body as string), { action: 'resolve' });
});

test('reopening a discussion posts the reopen action', async () => {
    const adapter = new DriveAdapter('folder', 'client');
    let body: unknown;
    Object.defineProperty(adapter, 'api', {
        value: async (_path: string, init?: RequestInit) => {
            body = JSON.parse(init!.body as string);
            return new Response(JSON.stringify({ id: 'reply2', action: 'reopen' }));
        },
    });

    await adapter.discussions!.setResolved('file1', 'comment1', false);

    assert.deepEqual(body, { action: 'reopen' });
});

test('auth tries a silent grant first and falls back to interactive when it fails', async (t) => {
    const descriptors = Object.fromEntries(
        ['document', 'google', 'fetch'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
    );
    const requests: ({ prompt?: string } | undefined)[] = [];
    Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: { querySelector: () => ({}) },
    });
    Object.defineProperty(globalThis, 'google', {
        configurable: true,
        value: {
            accounts: {
                oauth2: {
                    initTokenClient: ({ callback, error_callback }: { callback: (response: unknown) => void; error_callback: (error: { type: string }) => void }) => ({
                        requestAccessToken: (options?: { prompt?: string }) => {
                            requests.push(options);
                            // Silent ('none') grant fails without an active session; interactive succeeds.
                            if (options?.prompt === 'none') error_callback({ type: 'suppressed' });
                            else callback({ access_token: 'token' });
                        },
                    }),
                },
            },
        },
    });
    Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        value: async () => new Response('', { status: 403 }),
    });
    t.after(() => {
        for (const [name, descriptor] of Object.entries(descriptors)) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else Reflect.deleteProperty(globalThis, name);
        }
    });

    const adapter = new DriveAdapter('folder', 'client');
    await adapter.auth();

    assert.deepEqual(requests, [{ prompt: 'none' }, { prompt: '' }]);
});

test('auth reuses an unexpired cached token and skips the GIS request; drops an expired one', async (t) => {
    const descriptors = Object.fromEntries(
        ['document', 'google', 'fetch', 'localStorage'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
    );
    const store = new Map<string, string>();
    let requestCount = 0;
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => void store.set(k, v),
            removeItem: (k: string) => void store.delete(k),
        },
    });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { querySelector: () => ({}) } });
    Object.defineProperty(globalThis, 'google', {
        configurable: true,
        value: { accounts: { oauth2: { initTokenClient: ({ callback }: { callback: (r: unknown) => void }) => ({
            requestAccessToken: () => { requestCount += 1; callback({ access_token: 'fresh', expires_in: 3600 }); },
        }) } } },
    });
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async () => new Response('', { status: 403 }) });
    t.after(() => {
        for (const [name, descriptor] of Object.entries(descriptors)) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else Reflect.deleteProperty(globalThis, name);
        }
    });

    const key = 'glint.drive.token.client';

    // Unexpired cached token: no GIS request at all.
    store.set(key, JSON.stringify({ token: 'cached', expiresAt: Date.now() + 3_600_000 }));
    await new DriveAdapter('folder', 'client').auth();
    assert.equal(requestCount, 0);

    // Expired cached token: dropped, then a fresh token minted and re-cached.
    store.set(key, JSON.stringify({ token: 'stale', expiresAt: Date.now() - 1 }));
    await new DriveAdapter('folder', 'client').auth();
    assert.equal(requestCount, 1);
    assert.equal(JSON.parse(store.get(key)!).token, 'fresh');
});

test('rejects silent reauthentication when GIS reports a popup error', async (t) => {
    const descriptors = Object.fromEntries(
        ['document', 'google'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
    );
    let errorCallback: ((error: { type: string }) => void) | undefined;
    Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: { querySelector: () => ({}) },
    });
    Object.defineProperty(globalThis, 'google', {
        configurable: true,
        value: {
            accounts: {
                oauth2: {
                    initTokenClient: (options: { error_callback?: (error: { type: string }) => void }) => {
                        errorCallback = options.error_callback;
                        return { requestAccessToken: () => {} };
                    },
                },
            },
        },
    });
    t.after(() => {
        for (const [name, descriptor] of Object.entries(descriptors)) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else Reflect.deleteProperty(globalThis, name);
        }
    });

    const adapter = new DriveAdapter('folder', 'client') as DriveAdapter & { reauthenticate(): Promise<void> };
    const reauthentication = adapter.reauthenticate();
    await Promise.resolve();
    assert.equal(typeof errorCallback, 'function', 'GIS popup failures must reject the pending reauthentication');
    errorCallback?.({ type: 'popup_closed' });
    await assert.rejects(reauthentication, /Drive authentication expired/);
});

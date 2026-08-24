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

test('uses an interactive GIS request initially and a no-prompt request for silent reauthentication', async (t) => {
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
                    initTokenClient: ({ callback }: { callback: (response: unknown) => void }) => ({
                        requestAccessToken: (options?: { prompt?: string }) => {
                            requests.push(options);
                            callback({ access_token: 'token' });
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

    const adapter = new DriveAdapter('folder', 'client') as DriveAdapter & { reauthenticate(): Promise<void> };
    await adapter.auth();
    await adapter.reauthenticate();

    assert.deepEqual(requests, [{ prompt: '' }, { prompt: 'none' }]);
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

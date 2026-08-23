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

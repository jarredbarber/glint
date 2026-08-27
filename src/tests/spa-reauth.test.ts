import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withSilentReauth } from '../spa/storage/reauth.js';
import { AuthExpiredError, StorageAdapter } from '../spa/storage/types.js';

function fakeAdapter(over: Partial<StorageAdapter>): StorageAdapter {
    return {
        auth: async () => {},
        identity: () => ({ name: 'Test' }),
        list: async () => [],
        read: async () => ({ content: '', version: '1' }),
        write: async () => ({ version: '1' }),
        create: async (name: string) => ({ id: name, name, path: name, version: '1' }),
        delete: async () => {},
        createAsset: async () => {},
        readAsset: async () => new Blob(),
        ...over,
    } as StorageAdapter;
}

test('a one-off expiry silently reauthenticates and completes on retry', async () => {
    let calls = 0;
    let reauths = 0;
    const adapter = fakeAdapter({ reauthenticate: async () => { reauths += 1; } });
    const result = await withSilentReauth(adapter, async () => {
        calls += 1;
        if (calls === 1) throw new AuthExpiredError('expired');
        return 'ok';
    });
    assert.equal(result, 'ok');
    assert.equal(reauths, 1);
    assert.equal(calls, 2);
});

test('a persistent expiry rethrows AuthExpiredError after the single retry', async () => {
    const adapter = fakeAdapter({ reauthenticate: async () => {} });
    await assert.rejects(
        withSilentReauth(adapter, async () => { throw new AuthExpiredError('expired'); }),
        AuthExpiredError,
    );
});

test('a failed silent grant rethrows the original expiry, not the grant error', async () => {
    const adapter = fakeAdapter({ reauthenticate: async () => { throw new Error('google session gone'); } });
    await assert.rejects(
        withSilentReauth(adapter, async () => { throw new AuthExpiredError('expired'); }),
        AuthExpiredError,
    );
});

test('non-auth errors pass through untouched (no reauth attempt)', async () => {
    let reauths = 0;
    const adapter = fakeAdapter({ reauthenticate: async () => { reauths += 1; } });
    await assert.rejects(
        withSilentReauth(adapter, async () => { throw new Error('boom'); }),
        /boom/,
    );
    assert.equal(reauths, 0);
});

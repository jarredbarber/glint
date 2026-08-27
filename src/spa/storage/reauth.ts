import { AuthExpiredError, StorageAdapter } from './types.js';

// Mid-session Drive tokens expire ~1h. Silently re-grant (prompt: 'none') and retry the
// operation once before an expiry ever surfaces, mirroring the editor save path
// (editor/session.ts, #93). A failed silent grant or a second 401 rethrows AuthExpiredError
// so the caller's reconnect notice still fires.
export async function withSilentReauth<T>(adapter: StorageAdapter, op: () => Promise<T>): Promise<T> {
    try {
        return await op();
    } catch (error) {
        if (!(error instanceof AuthExpiredError) || !adapter.reauthenticate) throw error;
        try { await adapter.reauthenticate(); } catch { throw error; }
        return await op();
    }
}

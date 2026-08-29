import { StorageAdapter, FileMeta, AdapterCapabilities } from './types.js';

// Read-only backend for an arbitrary raw Markdown URL pasted on the landing page (#152).
// It plain-fetches one HTTPS document and exposes it as a single FileMeta — no project
// tree, no edit, no discussions, like a public GitHub blob. `connect-src https:` in the
// SPA CSP permits the cross-origin fetch. Write paths throw: this backend never mutates.
export class RawUrlAdapter implements StorageAdapter {
    constructor(private url: string) {}

    private name(): string {
        try {
            const last = new URL(this.url).pathname.split('/').filter(Boolean).pop();
            // Only trust a name that looks like a wiki file; otherwise treat it as Markdown.
            if (last && /\.(md|markdown|mdown|mkd|html?)$/i.test(last)) return decodeURIComponent(last);
        } catch { /* fall through to the default */ }
        return 'document.md';
    }

    async auth(): Promise<void> {}
    identity() { return { name: '' }; }
    capabilities(): AdapterCapabilities { return { canEdit: false, canComment: false }; }

    async list(): Promise<FileMeta[]> {
        return [{ id: this.url, name: this.name(), path: this.name(), version: '' }];
    }

    async read(id: string): Promise<{ content: string; version: string }> {
        let res: Response;
        try {
            res = await fetch(id, { redirect: 'follow' });
        } catch (error) {
            throw new Error(`Could not fetch ${id}: ${(error as Error).message}`);
        }
        if (!res.ok) throw new Error(`Could not fetch ${id}: HTTP ${res.status}`);
        return { content: await res.text(), version: '' };
    }

    async write(): Promise<{ version: string }> { throw new Error('Raw URL documents are read-only.'); }
    async create(): Promise<FileMeta> { throw new Error('Raw URL documents are read-only.'); }
    async delete(): Promise<void> { throw new Error('Raw URL documents are read-only.'); }
    async createAsset(): Promise<void> { throw new Error('Raw URL documents are read-only.'); }
    async readAsset(): Promise<Blob> { throw new Error('Raw URL documents have no assets.'); }
}

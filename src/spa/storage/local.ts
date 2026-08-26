// Local directory backend via the File System Access API (Chromium/Edge only).
// The directory handle is persisted in IndexedDB so the workspace survives reloads;
// permission is re-requested on return.
import { StorageAdapter, FileMeta, ConflictError } from './types.js';

export function localSupported(): boolean {
    return typeof (window as any).showDirectoryPicker === 'function';
}

// --- tiny IndexedDB single-key store (handles aren't localStorage-serializable) ---
const DB = 'glint-spa', STORE = 'handles', KEY = 'dir';

function idb(): Promise<IDBDatabase> {
    return new Promise((res, rej) => {
        const r = indexedDB.open(DB, 1);
        r.onupgradeneeded = () => r.result.createObjectStore(STORE);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
    });
}
async function idbGet<T>(): Promise<T | undefined> {
    const db = await idb();
    return new Promise((res, rej) => {
        const tx = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
        tx.onsuccess = () => res(tx.result as T);
        tx.onerror = () => rej(tx.error);
    });
}
async function idbSet(val: unknown): Promise<void> {
    const db = await idb();
    return new Promise((res, rej) => {
        const tx = db.transaction(STORE, 'readwrite').objectStore(STORE).put(val, KEY);
        tx.onsuccess = () => res();
        tx.onerror = () => rej(tx.error);
    });
}

type DirHandle = any; // FileSystemDirectoryHandle — types vary by TS lib version

export class LocalAdapter implements StorageAdapter {
    private dir: DirHandle | null = null;

    async auth(): Promise<void> {
        const saved = await idbGet<DirHandle>().catch(() => undefined);
        if (saved) {
            const perm = await saved.queryPermission({ mode: 'readwrite' });
            if (perm === 'granted' || (await saved.requestPermission({ mode: 'readwrite' })) === 'granted') {
                this.dir = saved;
                return;
            }
        }
        this.dir = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
        await idbSet(this.dir).catch(() => { /* non-fatal: handle just won't persist */ });
    }

    capabilities() { return { canEdit: true, canComment: false }; }
    identity() { return { name: 'Local' }; }

    // The chosen directory's name, for labelling the project after the folder (#69).
    folderName(): string | undefined { return this.dir?.name || undefined; }

    private need(): DirHandle {
        if (!this.dir) throw new Error('call auth() first');
        return this.dir;
    }

    async list(): Promise<FileMeta[]> {
        const out: FileMeta[] = [];
        const visit = async (dir: DirHandle, prefix = ''): Promise<void> => {
            for await (const [name, handle] of dir.entries()) {
                const path = prefix ? `${prefix}/${name}` : name;
                if (handle.kind === 'directory') {
                    await visit(handle, path);
                } else if (handle.kind === 'file' && /\.(md|markdown|mdown|mkd)$/i.test(name)) {
                    const file = await handle.getFile();
                    out.push({ id: path, name, path, version: String(file.lastModified) });
                }
            }
        };
        await visit(this.need());
        return out.sort((a, b) => a.path.localeCompare(b.path));
    }

    private async parentFor(path: string): Promise<{ dir: DirHandle; name: string }> {
        const parts = path.split('/').filter(Boolean);
        const name = parts.pop();
        if (!name) throw new Error('file path is required');
        let dir = this.need();
        for (const part of parts) dir = await dir.getDirectoryHandle(part);
        return { dir, name };
    }

    async read(id: string) {
        const { dir, name } = await this.parentFor(id);
        const fh = await dir.getFileHandle(name);
        const f = await fh.getFile();
        return { content: await f.text(), version: String(f.lastModified) };
    }

    async write(id: string, content: string, version: string) {
        const { dir, name } = await this.parentFor(id);
        // No { create: true }: validate optimistic concurrency BEFORE touching the
        // file. A file another process deleted must surface as a conflict, not be
        // silently resurrected as an empty file (#65).
        let fh;
        try {
            fh = await dir.getFileHandle(name);
        } catch (error) {
            if (error instanceof DOMException && error.name === 'NotFoundError') throw new ConflictError();
            throw error;
        }
        const current = String((await fh.getFile()).lastModified);
        if (current !== version) throw new ConflictError();
        const w = await fh.createWritable();
        await w.write(content);
        await w.close();
        return { version: String((await fh.getFile()).lastModified) };
    }

    async create(name: string, content: string): Promise<FileMeta> {
        const dir = this.need();
        try {
            await dir.getFileHandle(name);
            throw new Error(`file already exists: ${name}`);
        } catch (error) {
            if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error;
        }

        const fh = await dir.getFileHandle(name, { create: true });
        try {
            const writable = await fh.createWritable();
            await writable.write(content);
            await writable.close();
        } catch (error) {
            await dir.removeEntry(name).catch(() => {});
            throw error;
        }
        const file = await fh.getFile();
        return { id: name, name, path: name, version: String(file.lastModified) };
    }

    async delete(id: string): Promise<void> {
        const { dir, name } = await this.parentFor(id);
        await dir.removeEntry(name);
    }

    // Sidecar assets live in the page's existing parent, so parentFor walks (never
    // creates) directories; only the leaf file is created, create-only (#30/#70).
    async createAsset(path: string, content: Blob): Promise<void> {
        const { dir, name } = await this.parentFor(path);
        try {
            await dir.getFileHandle(name);
            throw new Error(`asset already exists: ${name}`);
        } catch (error) {
            if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error;
        }
        const fh = await dir.getFileHandle(name, { create: true });
        try {
            const writable = await fh.createWritable();
            await writable.write(content);
            await writable.close();
        } catch (error) {
            await dir.removeEntry(name).catch(() => {});
            throw error;
        }
    }

    async readAsset(path: string): Promise<Blob> {
        const { dir, name } = await this.parentFor(path);
        const fh = await dir.getFileHandle(name);
        return await fh.getFile();
    }
}

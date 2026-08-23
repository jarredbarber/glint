import { StorageAdapter, FileMeta, ConflictError } from './types.js';

interface Entry { meta: FileMeta; content: string; v: number; }

export { ConflictError };

export class FakeAdapter implements StorageAdapter {
    private entries = new Map<string, Entry>();
    private seq = 0;

    constructor(initial: { name: string; content: string }[] = []) {
        for (const it of initial) {
            const id = `f${++this.seq}`;
            this.entries.set(id, {
                meta: { id, name: it.name, path: it.name, version: '1' },
                content: it.content, v: 1,
            });
        }
    }
    async auth() {}
    identity() { return { name: 'Fake User' }; }
    async list(): Promise<FileMeta[]> { return [...this.entries.values()].map((e) => ({ ...e.meta })); }
    async read(id: string) {
        const e = this.entries.get(id);
        if (!e) throw new Error(`no such file: ${id}`);
        return { content: e.content, version: String(e.v) };
    }
    async write(id: string, content: string, version: string) {
        const e = this.entries.get(id);
        if (!e) throw new Error(`no such file: ${id}`);
        if (String(e.v) !== version) throw new ConflictError();
        e.v += 1; e.content = content; e.meta.version = String(e.v);
        return { version: String(e.v) };
    }
}

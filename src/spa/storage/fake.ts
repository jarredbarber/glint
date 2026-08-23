import { StorageAdapter, FileMeta, ConflictError } from './types.js';

interface Entry { meta: FileMeta; content: string; v: number; }

export { ConflictError };

export class FakeAdapter implements StorageAdapter {
    private entries = new Map<string, Entry>();
    private seq = 0;

    constructor(initial: { name: string; content: string }[] = []) {
        for (const it of initial) {
            const id = `f${++this.seq}`;
            const path = it.name;
            const name = path.split('/').pop()!;
            this.entries.set(id, {
                meta: { id, name, path, version: '1' },
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

    async create(name: string, content: string): Promise<FileMeta> {
        if ([...this.entries.values()].some((entry) => entry.meta.name === name)) {
            throw new Error(`file already exists: ${name}`);
        }
        const id = `f${++this.seq}`;
        const meta = { id, name, path: name, version: '1' };
        this.entries.set(id, { meta, content, v: 1 });
        return { ...meta };
    }

    async delete(id: string): Promise<void> {
        if (!this.entries.delete(id)) throw new Error(`no such file: ${id}`);
    }
}

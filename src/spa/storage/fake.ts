import { StorageAdapter, FileMeta, ConflictError, Discussion, DiscussionCapability, DiscussionReply } from './types.js';

interface Entry { meta: FileMeta; content: string; v: number; }

export { ConflictError };

export class FakeAdapter implements StorageAdapter {
    private entries = new Map<string, Entry>();
    private seq = 0;
    private discussionsByFile = new Map<string, Discussion[]>();
    private discussionSeq = 0;
    discussions: DiscussionCapability = {
        list: async (fileId) => this.discussionsByFile.get(fileId)?.map((discussion) => ({ ...discussion, replies: [...discussion.replies] })) ?? [],
        create: async (fileId, anchor, content) => {
            const discussion: Discussion = { id: `d${++this.discussionSeq}`, content, anchor, author: 'Fake User', createdAt: new Date(0).toISOString(), resolved: false, replies: [] };
            this.discussionsByFile.set(fileId, [...(this.discussionsByFile.get(fileId) ?? []), discussion]);
            return discussion;
        },
        reply: async (fileId, discussionId, content) => {
            const discussion = this.discussionsByFile.get(fileId)?.find((item) => item.id === discussionId);
            if (!discussion) throw new Error(`no such discussion: ${discussionId}`);
            const reply: DiscussionReply = { id: `r${++this.discussionSeq}`, content, author: 'Fake User', createdAt: new Date(0).toISOString() };
            discussion.replies.push(reply);
            return reply;
        },
        setResolved: async (fileId, discussionId, resolved) => {
            const discussion = this.discussionsByFile.get(fileId)?.find((item) => item.id === discussionId);
            if (!discussion) throw new Error(`no such discussion: ${discussionId}`);
            discussion.resolved = resolved;
        },
    };

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
    capabilities() { return { canEdit: true, canComment: true }; }
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

    private assets = new Map<string, Blob>();
    async createAsset(path: string, content: Blob): Promise<void> {
        if (this.assets.has(path)) throw new Error(`asset already exists: ${path}`);
        this.assets.set(path, content);
    }
    async readAsset(path: string): Promise<Blob> {
        const blob = this.assets.get(path);
        if (!blob) throw new Error(`no such asset: ${path}`);
        return blob;
    }
}

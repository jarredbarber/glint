// The storage seam: one interface, four implementations (Fake, Drive, GitHub, Local).
// `version` is the backend's native concurrency token (Drive modifiedTime,
// GitHub blob sha, local lastModified). A write with a stale version is a conflict.
export interface FileMeta { id: string; name: string; path: string; version: string; }

export type DiscussionAnchor = {
    version: 1;
    sourceLine: number;
    quote: string;
    before: string | null;
    after: string | null;
};

export type DiscussionReply = { id: string; content: string; author: string; createdAt: string };
export type Discussion = {
    id: string;
    content: string;
    author: string;
    createdAt: string;
    resolved: boolean;
    anchor: DiscussionAnchor | null;
    replies: DiscussionReply[];
};

export interface DiscussionCapability {
    list(fileId: string): Promise<Discussion[]>;
    create(fileId: string, anchor: DiscussionAnchor, content: string): Promise<Discussion>;
    reply(fileId: string, discussionId: string, content: string): Promise<DiscussionReply>;
    setResolved(fileId: string, discussionId: string, resolved: boolean): Promise<void>;
}

export interface StorageAdapter {
    auth(): Promise<void>;
    reauthenticate?(): Promise<void>;
    identity(): { name: string };
    list(): Promise<FileMeta[]>;
    read(id: string): Promise<{ content: string; version: string }>;
    write(id: string, content: string, version: string): Promise<{ version: string }>;
    create(name: string, content: string): Promise<FileMeta>;
    delete(id: string): Promise<void>;
    discussions?: DiscussionCapability;
}

export class AuthExpiredError extends Error {
    constructor(message = 'authentication expired') {
        super(message);
        this.name = 'AuthExpiredError';
    }
}

export class ConflictError extends Error {
    constructor(msg = 'stale version') { super(msg); this.name = 'ConflictError'; }
}

// The storage seam: one interface, four implementations (Fake, Drive, GitHub, Local).
// `version` is the backend's native concurrency token (Drive modifiedTime,
// GitHub blob sha, local lastModified). A write with a stale version is a conflict.
// `author`/`modifiedTime` are optional backend-provided metadata (#87), used as
// defaults when a document's YAML frontmatter omits them. Absent on backends that
// don't expose them (frontmatter still wins where present).
export interface FileMeta { id: string; name: string; path: string; version: string; author?: string; modifiedTime?: string; }

// Files the wiki surfaces: Markdown pages plus raw HTML pages (#129). HTML pages are
// rendered as-is inside a sandboxed iframe rather than through the Markdown pipeline.
export function isHtmlFile(name: string): boolean { return /\.html?$/i.test(name); }
export function isWikiFile(name: string): boolean { return /\.(md|markdown|mdown|mkd|html?)$/i.test(name); }

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

// Read-only capability reporting (#59). Absent means fully capable (canEdit,
// canComment both true). The UI hides Save/write affordances when canEdit is false.
export interface AdapterCapabilities { canEdit: boolean; canComment: boolean; }

export interface StorageAdapter {
    auth(): Promise<void>;
    reauthenticate?(): Promise<void>;
    identity(): { name: string };
    capabilities?(): AdapterCapabilities;
    list(): Promise<FileMeta[]>;
    read(id: string): Promise<{ content: string; version: string }>;
    write(id: string, content: string, version: string): Promise<{ version: string }>;
    create(name: string, content: string): Promise<FileMeta>;
    delete(id: string): Promise<void>;
    // Portable image sidecars (#30/#70). `path` is a workspace-root-relative POSIX path
    // that resolves to a sibling of an existing page. createAsset is create-only (never
    // overwrites) and makes no directories; readAsset returns opaque bytes.
    createAsset(path: string, content: Blob): Promise<void>;
    readAsset(path: string): Promise<Blob>;
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

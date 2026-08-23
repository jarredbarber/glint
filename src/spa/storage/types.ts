// The storage seam: one interface, four implementations (Fake, Drive, GitHub, Local).
// `version` is the backend's native concurrency token (Drive modifiedTime,
// GitHub blob sha, local lastModified). A write with a stale version is a conflict.
export interface FileMeta { id: string; name: string; path: string; version: string; }

export interface StorageAdapter {
    auth(): Promise<void>;
    reauthenticate?(): Promise<void>;
    identity(): { name: string };
    list(): Promise<FileMeta[]>;
    read(id: string): Promise<{ content: string; version: string }>;
    write(id: string, content: string, version: string): Promise<{ version: string }>;
    create(name: string, content: string): Promise<FileMeta>;
    delete(id: string): Promise<void>;
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

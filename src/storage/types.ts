
export interface FileEntry {
    name: string;
    path: string;
    type: 'file' | 'directory';
    mtime?: Date;
    size?: number;
}

/**
 * Options for write operations
 */
export interface WriteOptions {
    /** Commit message (for GitHub provider) */
    message?: string;

    /** Expected content hash for optimistic locking */
    expectedHash?: string;

    /** Author information (for GitHub commits) */
    author?: {
        name: string;
        email: string;
    };
}

/**
 * Search options
 */
export interface SearchOptions {
    /** Case sensitive search */
    caseSensitive?: boolean;

    /** Maximum results to return */
    limit?: number;

    /** File pattern to filter (glob) */
    pattern?: string;
}

export interface SearchResult {
    path: string;
    matches: Array<{
        line: number;
        content: string;
        context?: string;
    }>;
    score?: number;
}

export interface VersionEntry {
    sha: string;
    message: string;
    author: string;
    date: Date;
    url?: string;
}

export interface GitStatus {
    isRepo: boolean;
    branch: string | null;
    ahead: number;
    behind: number;
    hasChanges: boolean;
    clean: boolean;
    message?: string;
}

export interface GitSyncResult {
    success: boolean;
    pulledChanges: boolean;
    pushedChanges: boolean;
    messages: string[];
    error?: string;
}

export interface GitPullResult {
    success: boolean;
    changes: boolean;
    message: string;
}

export interface GitPushResult {
    success: boolean;
    pushed: boolean;
    message: string;
}

export interface StorageProvider {
    readonly name: string;

    // Core CRUD operations
    read(path: string): Promise<string>;
    readBuffer(path: string): Promise<Buffer>;
    write(path: string, content: string, options?: WriteOptions): Promise<void>;
    writeBuffer(path: string, content: Buffer, options?: WriteOptions): Promise<void>;
    delete(path: string): Promise<void>;
    exists(path: string): Promise<boolean>;
    move(oldPath: string, newPath: string): Promise<void>;

    // Directory operations
    list(directory: string): Promise<FileEntry[]>;

    // Full-text search (optional)
    search?(query: string, options?: SearchOptions): Promise<SearchResult[]>;

    // Version history (optional, mainly GitHub)
    history?(path: string): Promise<VersionEntry[]>;

    // Git operations (optional)
    getGitStatus?(): Promise<GitStatus>;
    gitSync?(): Promise<GitSyncResult>;
    gitPull?(): Promise<GitPullResult>;
    gitPush?(): Promise<GitPushResult>;

    // Get file stats
    stat(path: string): Promise<{
        size: number;
        mtime: Date;
        isDirectory: boolean;
    }>;

    // Watch for changes (optional)
    watch?(path: string, listener: (event: 'change' | 'rename', filename: string) => void): () => void;
}

export {
    type StorageConfig,
    type StorageProviderConfig as ProviderConfig,
    type MountConfig,
    type CacheConfig
} from '../config.js';

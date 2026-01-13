
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

export interface StorageProvider {
    readonly name: string;

    // Core CRUD operations
    read(path: string): Promise<string>;
    write(path: string, content: string, options?: WriteOptions): Promise<void>;
    delete(path: string): Promise<void>;
    exists(path: string): Promise<boolean>;
    move(oldPath: string, newPath: string): Promise<void>;

    // Directory operations
    list(directory: string): Promise<FileEntry[]>;

    // Full-text search (optional)
    search?(query: string, options?: SearchOptions): Promise<SearchResult[]>;

    // Version history (optional, mainly GitHub)
    history?(path: string): Promise<VersionEntry[]>;

    // Get file stats (optional)
    stat?(path: string): Promise<{
        size: number;
        mtime: Date;
        isDirectory: boolean;
    }>;
}

export interface StorageConfig {
    default: string;
    providers: Record<string, ProviderConfig>;
    mounts: MountConfig[];
}

export type ProviderConfig =
    | { type: 'local'; basePath: string }
    | { type: 'github'; owner: string; repo: string; branch?: string; token?: string };

export interface MountConfig {
    prefix: string;
    provider: string;
}

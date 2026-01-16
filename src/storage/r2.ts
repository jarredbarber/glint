/**
 * R2 Storage Provider - Cloudflare R2 object storage backend.
 * Used for Cloudflare Workers deployment.
 */

import type { FileEntry, StorageProvider, WriteOptions, BatchWriteItem } from './types.js';

/**
 * Cloudflare R2 bucket interface (minimal typing for what we need)
 */
export interface R2Bucket {
    get(key: string): Promise<R2Object | null>;
    put(key: string, value: string | ArrayBuffer | Blob | ReadableStream, options?: R2PutOptions): Promise<R2Object>;
    delete(key: string | string[]): Promise<void>;
    list(options?: R2ListOptions): Promise<R2Objects>;
    head(key: string): Promise<R2Object | null>;
}

interface R2Object {
    key: string;
    version: string;
    size: number;
    etag: string;
    uploaded: Date;
    httpMetadata?: R2HTTPMetadata;
    customMetadata?: Record<string, string>;
    body?: ReadableStream;
    bodyUsed?: boolean;
    arrayBuffer(): Promise<ArrayBuffer>;
    text(): Promise<string>;
    json<T>(): Promise<T>;
    blob(): Promise<Blob>;
}

interface R2HTTPMetadata {
    contentType?: string;
    contentLanguage?: string;
    contentDisposition?: string;
    contentEncoding?: string;
    cacheControl?: string;
    cacheExpiry?: Date;
}

interface R2PutOptions {
    httpMetadata?: R2HTTPMetadata;
    customMetadata?: Record<string, string>;
}

interface R2ListOptions {
    prefix?: string;
    delimiter?: string;
    cursor?: string;
    limit?: number;
}

interface R2Objects {
    objects: R2Object[];
    truncated: boolean;
    cursor?: string;
    delimitedPrefixes: string[];
}

/**
 * R2 Storage Provider implementation
 */
export class R2StorageProvider implements StorageProvider {
    readonly name: string;
    private bucket: R2Bucket;

    constructor(name: string, bucket: R2Bucket) {
        this.name = name;
        this.bucket = bucket;
    }

    async read(path: string): Promise<string> {
        const object = await this.bucket.get(this.normalizePath(path));
        if (!object) {
            throw new Error(`File not found: ${path}`);
        }
        return object.text();
    }

    async readBuffer(path: string): Promise<Buffer> {
        const object = await this.bucket.get(this.normalizePath(path));
        if (!object) {
            throw new Error(`File not found: ${path}`);
        }
        const arrayBuffer = await object.arrayBuffer();
        return Buffer.from(arrayBuffer);
    }

    async write(path: string, content: string, _options?: WriteOptions): Promise<void> {
        await this.bucket.put(this.normalizePath(path), content, {
            httpMetadata: {
                contentType: this.getContentType(path),
            },
        });
    }

    async writeBuffer(path: string, content: Buffer, _options?: WriteOptions): Promise<void> {
        // Convert Buffer to ArrayBuffer for R2 compatibility
        const arrayBuffer = content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer;
        await this.bucket.put(this.normalizePath(path), arrayBuffer, {
            httpMetadata: {
                contentType: this.getContentType(path),
            },
        });
    }

    async delete(path: string): Promise<void> {
        await this.bucket.delete(this.normalizePath(path));
    }

    async exists(path: string): Promise<boolean> {
        const object = await this.bucket.head(this.normalizePath(path));
        return object !== null;
    }

    async move(oldPath: string, newPath: string): Promise<void> {
        // R2 doesn't have a native move - read, write, delete
        const content = await this.readBuffer(oldPath);
        await this.writeBuffer(newPath, content);
        await this.delete(oldPath);
    }

    async batchWrite(items: BatchWriteItem[], _options?: WriteOptions): Promise<void> {
        // R2 doesn't have batch operations, write sequentially
        for (const item of items) {
            await this.write(item.path, item.content);
        }
    }

    async list(directory: string): Promise<FileEntry[]> {
        const prefix = this.normalizePath(directory);
        const prefixWithSlash = prefix ? `${prefix}/` : '';

        const entries: FileEntry[] = [];
        let cursor: string | undefined;

        do {
            const result = await this.bucket.list({
                prefix: prefixWithSlash,
                delimiter: '/',
                cursor,
            });

            // Add files
            for (const object of result.objects) {
                const relativePath = object.key.slice(prefixWithSlash.length);
                if (relativePath && !relativePath.includes('/')) {
                    entries.push({
                        name: relativePath,
                        path: object.key,
                        type: 'file',
                        mtime: object.uploaded,
                        size: object.size,
                    });
                }
            }

            // Add directories from delimited prefixes
            for (const dirPrefix of result.delimitedPrefixes) {
                const dirName = dirPrefix.slice(prefixWithSlash.length).replace(/\/$/, '');
                if (dirName) {
                    entries.push({
                        name: dirName,
                        path: dirPrefix.replace(/\/$/, ''),
                        type: 'directory',
                    });
                }
            }

            cursor = result.truncated ? result.cursor : undefined;
        } while (cursor);

        return entries;
    }

    async stat(path: string): Promise<{ size: number; mtime: Date; isDirectory: boolean }> {
        const normalizedPath = this.normalizePath(path);

        // Check if it's a file
        const object = await this.bucket.head(normalizedPath);
        if (object) {
            return {
                size: object.size,
                mtime: object.uploaded,
                isDirectory: false,
            };
        }

        // Check if it's a directory (has objects with this prefix)
        const result = await this.bucket.list({
            prefix: `${normalizedPath}/`,
            limit: 1,
        });

        if (result.objects.length > 0 || result.delimitedPrefixes.length > 0) {
            return {
                size: 0,
                mtime: new Date(),
                isDirectory: true,
            };
        }

        throw new Error(`Path not found: ${path}`);
    }

    // R2 doesn't support watching
    watch(): () => void {
        // No-op on R2
        return () => { };
    }

    private normalizePath(path: string): string {
        // Remove leading slashes
        return path.replace(/^\/+/, '');
    }

    private getContentType(path: string): string {
        const ext = path.split('.').pop()?.toLowerCase();
        const contentTypes: Record<string, string> = {
            'md': 'text/markdown',
            'json': 'application/json',
            'html': 'text/html',
            'css': 'text/css',
            'js': 'application/javascript',
            'png': 'image/png',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'gif': 'image/gif',
            'svg': 'image/svg+xml',
            'webp': 'image/webp',
        };
        return contentTypes[ext || ''] || 'application/octet-stream';
    }
}

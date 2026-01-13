
import { LRUCache } from 'lru-cache';

export interface CacheConfig {
    ttl: number; // milliseconds
    maxSize: number; // bytes
}

export class ContentCache<T extends {}> {
    private cache: LRUCache<string, T>;

    constructor(config: CacheConfig) {
        this.cache = new LRUCache<string, T>({
            maxSize: config.maxSize,
            sizeCalculation: (value: T) => {
                // Rough estimation of object size in bytes
                // For strings, length * 2 (utf-16)
                // For objects, JSON stringify length
                if (typeof value === 'string') return value.length;
                try {
                    return JSON.stringify(value).length;
                } catch {
                    return 1000; // Fallback for circular structures or errors
                }
            },
            ttl: config.ttl,
        });
    }

    get(key: string): T | undefined {
        return this.cache.get(key);
    }

    set(key: string, value: T): void {
        this.cache.set(key, value);
    }

    invalidate(key: string): void {
        this.cache.delete(key);
    }

    invalidateByPrefix(prefix: string): void {
        // Iterate and delete keys starting with prefix
        // Note: lru-cache doesn't have a direct prefix delete, so we iterate
        for (const key of this.cache.keys()) {
            if (key.startsWith(prefix)) {
                this.cache.delete(key);
            }
        }
    }

    clear(): void {
        this.cache.clear();
    }
}

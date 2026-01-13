import { z } from 'zod';
import { StorageManager } from '../storage/index.js';
import crypto from 'node:crypto';

export const ShareConfigSchema = z.object({
    id: z.string(),
    filePath: z.string(),
    access: z.enum(['view', 'comment', 'edit']),
    createdAt: z.number(),
    expiresAt: z.number().optional(),
    label: z.string().optional()
});

export type ShareConfig = z.infer<typeof ShareConfigSchema>;

export class ShareService {
    private sharesPath = '.glint/shares.json';
    private shares: ShareConfig[] = [];
    private storage: StorageManager;

    constructor(storage: StorageManager) {
        this.storage = storage;
    }

    async load(): Promise<void> {
        try {
            if (await this.storage.exists(this.sharesPath)) {
                const raw = await this.storage.read(this.sharesPath);
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    this.shares = parsed
                        .map(s => {
                            try {
                                return ShareConfigSchema.parse(s);
                            } catch (err) {
                                console.error('Failed to parse share config:', err);
                                return null;
                            }
                        })
                        .filter((s): s is ShareConfig => s !== null);
                }
            } else {
                this.shares = [];
                await this.save();
            }
        } catch (err) {
            console.error('Failed to load shares:', err);
            // Don't throw, just start with empty
            this.shares = [];
        }
    }

    async save(): Promise<void> {
        await this.storage.write(this.sharesPath, JSON.stringify(this.shares, null, 4));
    }

    async createShare(params: {
        filePath: string;
        access: ShareConfig['access'];
        expiresAt?: number;
        label?: string;
    }): Promise<ShareConfig> {
        // Generate a 12-character random ID (6 bytes in hex = 12 chars)
        const id = crypto.randomBytes(6).toString('hex');

        const newShare: ShareConfig = {
            id,
            filePath: params.filePath,
            access: params.access,
            createdAt: Date.now(),
            expiresAt: params.expiresAt,
            label: params.label
        };

        this.shares.push(newShare);
        await this.save();
        return newShare;
    }

    getShare(id: string): ShareConfig | undefined {
        const share = this.shares.find(s => s.id === id);
        if (share && share.expiresAt && share.expiresAt < Date.now()) {
            // Expired - we could remove it here but better to let a periodic cleanup handle it
            // or just treat it as not found.
            return undefined;
        }
        return share;
    }

    async revokeShare(id: string): Promise<boolean> {
        const initialLength = this.shares.length;
        this.shares = this.shares.filter(s => s.id !== id);
        if (this.shares.length !== initialLength) {
            await this.save();
            return true;
        }
        return false;
    }

    getSharesForFile(filePath: string): ShareConfig[] {
        return this.shares.filter(s => s.filePath === filePath);
    }

    /**
     * Remove all expired shares
     */
    async cleanup(): Promise<void> {
        const now = Date.now();
        const initialLength = this.shares.length;
        this.shares = this.shares.filter(s => !s.expiresAt || s.expiresAt > now);
        if (this.shares.length !== initialLength) {
            await this.save();
        }
    }
}

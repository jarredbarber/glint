import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ShareService } from '../server/share.js';
import { StorageManager } from '../storage/index.js';
import { GlintConfig } from '../config.js';

test('ShareService', async (t) => {
    // Setup temp directory
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'glint-test-'));

    const mockConfig = {
        storage: {
            default: 'local',
            providers: {
                local: { type: 'local', basePath: tempDir }
            },
            mounts: []
        }
    } as unknown as GlintConfig;

    const storage = new StorageManager(mockConfig, tempDir);
    const service = new ShareService(storage);
    await service.load();

    // Ensure cleanup
    t.after(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    await t.test('creates and retrieves a share', async () => {
        const share = await service.createShare({
            filePath: 'doc.md',
            access: 'view',
            label: 'Test Share'
        });

        assert.ok(share.id);
        assert.equal(share.filePath, 'doc.md');
        assert.equal(share.label, 'Test Share');

        const retrieved = service.getShare(share.id);
        assert.deepEqual(retrieved, share);
    });

    await t.test('handles expired shares', async () => {
        const share = await service.createShare({
            filePath: 'expired.md',
            access: 'view',
            expiresAt: Date.now() - 1000 // Past
        });

        const retrieved = service.getShare(share.id);
        assert.equal(retrieved, undefined);
    });

    await t.test('revokes a share', async () => {
        const share = await service.createShare({
            filePath: 'revoked.md',
            access: 'edit'
        });

        const success = await service.revokeShare(share.id);
        assert.ok(success);
        assert.equal(service.getShare(share.id), undefined);
    });

    await t.test('persistence', async () => {
        // Create new service pointing to same dir to test load()
        const newService = new ShareService(storage);
        await newService.load();

        // Should have the remaining valid shares
        const shares = newService.getSharesForFile('doc.md');
        assert.equal(shares.length, 1);
        assert.equal(shares[0].filePath, 'doc.md');
    });
});

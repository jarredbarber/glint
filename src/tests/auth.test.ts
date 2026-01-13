import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, isAuthenticated, getRequestAccess } from '../server/auth.js';
import { GlintConfig } from '../config.js';

test('auth: password hashing', async (t) => {
    await t.test('hashes and verifies password', async () => {
        const password = 'my-secret-password';
        const hash = await hashPassword(password);

        assert.notEqual(password, hash);
        assert.ok(await verifyPassword(password, hash));
        assert.equal(await verifyPassword('wrong-password', hash), false);
    });
});

test('auth: state check', async (t) => {
    const config: GlintConfig = {
        port: 3000,
        host: 'localhost',
        theme: 'nord',
        baseFile: 'README.md',
        storage: {
            default: 'local',
            providers: { local: { type: 'local', basePath: '.' } },
            mounts: [],
            cache: { enabled: true, ttl: 300000, maxSize: 100 * 1024 * 1024 }
        },
        auth: {
            enabled: true,
            passwordHash: 'hash',
            sessionSecret: 'test-secret-key-1234567890',
            public: []
        }
    };

    await t.test('returns false when no cookie', () => {
        const req = { cookies: {} } as any;
        assert.equal(isAuthenticated(req, config), false);
    });

    await t.test('returns true when auth disabled', () => {
        const noAuthConfig = { ...config, auth: { ...config.auth!, enabled: false } };
        const req = { cookies: {} } as any;
        assert.equal(isAuthenticated(req, noAuthConfig), true);
    });
});

test('auth: access control', async (t) => {
    const config: GlintConfig = {
        port: 3000,
        host: 'localhost',
        theme: 'nord',
        baseFile: 'README.md',
        storage: {
            default: 'local',
            providers: { local: { type: 'local', basePath: '.' } },
            mounts: [],
            cache: { enabled: true, ttl: 300000, maxSize: 100 * 1024 * 1024 }
        },
        auth: {
            enabled: true,
            passwordHash: 'hash',
            sessionSecret: 'secret',
            public: [
                { path: 'public/**', access: 'view' },
                { path: 'README.md', access: 'view' }
            ]
        }
    };

    await t.test('grants view access to public files', () => {
        const req = { cookies: {} } as any;
        assert.equal(getRequestAccess(req, config, 'README.md'), 'view');
        assert.equal(getRequestAccess(req, config, 'public/doc.md'), 'view');
    });

    await t.test('denies access to private files', () => {
        const req = { cookies: {} } as any;
        assert.equal(getRequestAccess(req, config, 'private.md'), null);
    });
});

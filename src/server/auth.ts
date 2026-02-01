import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cookie from '@fastify/cookie';
import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { GlintConfig, getPublicAccess, AccessLevel } from '../config.js';

const SESSION_COOKIE_NAME = 'glint_session';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

interface SessionData {
    authenticated: boolean;
    createdAt: number;
}

/**
 * Creates a signed session token.
 */
function createSessionToken(secret: string): string {
    const data: SessionData = {
        authenticated: true,
        createdAt: Date.now(),
    };
    const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
    const signature = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('base64url');
    return `${payload}.${signature}`;
}

/**
 * Verifies and decodes a session token.
 */
function verifySessionToken(token: string, secret: string): SessionData | null {
    const parts = token.split('.');
    if (parts.length !== 2) return null;

    const [payload, signature] = parts;
    const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('base64url');

    if (signature !== expectedSignature) return null;

    try {
        const data: SessionData = JSON.parse(
            Buffer.from(payload, 'base64url').toString('utf-8')
        );

        // Check if session has expired
        if (Date.now() - data.createdAt > SESSION_MAX_AGE) {
            return null;
        }

        return data;
    } catch {
        return null;
    }
}

/**
 * Verify a password against a bcrypt hash.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
}

/**
 * Hash a password with bcrypt.
 */
export async function hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
}



/**
 * Check if a request is authenticated.
 */
export function isAuthenticated(request: FastifyRequest, config: GlintConfig): boolean {
    if (!config.auth?.enabled) {
        return true; // No auth = always authenticated
    }

    // Check for service token (Bearer auth) - for programmatic API access (Hector)
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        if (config.auth.serviceToken && token === config.auth.serviceToken) {
            return true;
        }
    }

    const sessionSecret = config.auth.sessionSecret;
    if (!sessionSecret) {
        return false; // No secret configured = can't authenticate
    }

    const sessionToken = (request.cookies as Record<string, string>)?.[SESSION_COOKIE_NAME];
    if (!sessionToken) {
        return false;
    }

    const session = verifySessionToken(sessionToken, sessionSecret);
    return session?.authenticated === true;
}

/**
 * Get the access level for a request (considering auth state and public paths).
 */
export function getRequestAccess(
    request: FastifyRequest,
    config: GlintConfig,
    urlPath: string
): AccessLevel | null {
    // 1. Check if user is authenticated
    if (isAuthenticated(request, config)) {
        return 'edit'; // Authenticated users have full access
    }

    // 2. Check if path is public
    const publicAccess = getPublicAccess(config, urlPath);
    if (publicAccess) return publicAccess;

    return null;
}

import { ShareService } from './share.js';

/**
 * Setup auth middleware and cookie plugin for Fastify.
 */
export async function setupAuth(
    fastify: FastifyInstance,
    getConfig: () => GlintConfig,
    shareService?: ShareService
) {
    // Register cookie plugin
    await fastify.register(cookie, {
        parseOptions: {},
    });

    // Add auth check to request object
    fastify.decorateRequest('isAuthenticated', function () {
        return isAuthenticated(this, getConfig());
    });

    fastify.decorateRequest('getAccess', function (urlPath: string) {
        return getRequestAccess(this, getConfig(), urlPath);
    });

    fastify.decorateRequest('getShareAccess', function (urlPath: string, shareId?: string) {
        if (!shareId || !shareService) return null;

        const share = shareService.getShare(shareId);
        if (!share) return null;

        // Verify the share points to the requested file
        if (share.filePath === urlPath) {
            return share.access;
        }

        // If it's an asset within the share's context, allowed
        // (This is a bit loose but Asset API will handle context validation)
        return null;
    });
}

/**
 * Create a session cookie for an authenticated user.
 */
export function createSessionCookie(
    reply: FastifyReply,
    config: GlintConfig
): void {
    if (!config.auth?.sessionSecret) {
        throw new Error('Session secret not configured');
    }

    const token = createSessionToken(config.auth.sessionSecret);

    reply.setCookie(SESSION_COOKIE_NAME, token, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: SESSION_MAX_AGE / 1000, // in seconds
    });
}

/**
 * Clear the session cookie (logout).
 */
export function clearSessionCookie(reply: FastifyReply): void {
    reply.clearCookie(SESSION_COOKIE_NAME, {
        path: '/',
    });
}

// Extend FastifyRequest type
declare module 'fastify' {
    interface FastifyRequest {
        isAuthenticated(): boolean;
        getAccess(urlPath: string): AccessLevel | null;
        getShareAccess(urlPath: string, shareId?: string): AccessLevel | null;
    }
}

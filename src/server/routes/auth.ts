import { FastifyInstance } from 'fastify';
import { GlintConfig } from '../../config.js';
import {
    verifyPassword,
    createSessionCookie,
    clearSessionCookie,
} from '../auth.js';
import { renderLoginPage } from '../../renderer.js';

export async function setupAuthRoutes(
    fastify: FastifyInstance,
    getConfig: () => GlintConfig
) {
    // GET /api/auth/login - Render login page
    fastify.get('/api/auth/login', async (request, reply) => {
        const config = getConfig();

        // If auth is not enabled, redirect to home
        if (!config.auth?.enabled) {
            return reply.redirect('/');
        }

        // If already authenticated, redirect to intended destination or home
        if (request.isAuthenticated()) {
            const redirect = (request.query as { redirect?: string }).redirect || '/';
            return reply.redirect(redirect);
        }

        const redirect = (request.query as { redirect?: string }).redirect || '/';
        const error = (request.query as { error?: string }).error;

        const html = renderLoginPage(config, redirect, error);
        return reply.type('text/html').send(html);
    });

    // POST /api/auth/login - Process login
    fastify.post('/api/auth/login', async (request, reply) => {
        const config = getConfig();

        // If auth is not enabled, return error
        if (!config.auth?.enabled) {
            return reply.code(400).send({ error: 'Auth is not enabled' });
        }

        const { password, redirect } = request.body as {
            password?: string;
            redirect?: string;
        };

        if (!password) {
            // Form submission - redirect back with error
            const redirectPath = redirect || '/';
            return reply.redirect(`/api/auth/login?redirect=${encodeURIComponent(redirectPath)}&error=Password required`);
        }

        if (!config.auth.passwordHash) {
            return reply.redirect('/api/auth/login?error=Password not configured');
        }

        const valid = await verifyPassword(password, config.auth.passwordHash);

        if (!valid) {
            const redirectPath = redirect || '/';
            return reply.redirect(`/api/auth/login?redirect=${encodeURIComponent(redirectPath)}&error=Invalid password`);
        }

        // Create session
        createSessionCookie(reply, config);

        // Redirect to intended destination
        const redirectPath = redirect || '/';
        return reply.redirect(redirectPath);
    });

    // POST /api/auth/logout - Process logout
    fastify.post('/api/auth/logout', async (request, reply) => {
        clearSessionCookie(reply);

        // Check for redirect query param or default to login
        const redirect = (request.query as { redirect?: string }).redirect;
        if (redirect) {
            return reply.redirect(redirect);
        }

        return { success: true };
    });

    // GET /api/auth/status - Check authentication status
    fastify.get('/api/auth/status', async (request, reply) => {
        const config = getConfig();

        return {
            authEnabled: config.auth?.enabled ?? false,
            authenticated: request.isAuthenticated(),
        };
    });
}

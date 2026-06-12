import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import crypto from 'node:crypto';

const COOKIE_NAME = 'glint-session';
const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 days in seconds

// Simple in-memory session tokens
const validTokens = new Set<string>();

function parseCookies(raw: string | undefined): Record<string, string> {
    if (!raw) return {};
    const cookies: Record<string, string> = {};
    for (const pair of raw.split(';')) {
        const [key, ...rest] = pair.trim().split('=');
        if (key) cookies[key] = rest.join('=');
    }
    return cookies;
}

function isAuthenticated(request: FastifyRequest): boolean {
    const cookies = parseCookies(request.headers.cookie);
    const token = cookies[COOKIE_NAME];
    return !!token && validTokens.has(token);
}

function setSessionCookie(reply: FastifyReply): void {
    const token = crypto.randomBytes(32).toString('hex');
    validTokens.add(token);
    reply.header('Set-Cookie',
        `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`
    );
}

const LOGIN_HTML = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Login — Glint</title>
<style>
  body { font-family: system-ui; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #1a1b26; color: #c0caf5; }
  form { background: #24283b; padding: 2rem; border-radius: 8px; min-width: 280px; }
  h1 { font-size: 1.2rem; margin: 0 0 1rem; }
  input { display: block; width: 100%; padding: 0.5rem; margin: 0.5rem 0 1rem; border: 1px solid #414868; border-radius: 4px; background: #1a1b26; color: #c0caf5; box-sizing: border-box; }
  button { padding: 0.5rem 1.5rem; background: #7aa2f7; color: #1a1b26; border: none; border-radius: 4px; cursor: pointer; font-weight: 600; }
  .error { color: #f7768e; font-size: 0.9rem; }
</style>
</head><body>
<form method="POST" action="/login">
  <h1>Glint</h1>
  <label for="password">Password</label>
  <input type="password" name="password" id="password" autofocus>
  <button type="submit">Log in</button>
  {{error}}
</form>
</body></html>`;

export function setupAuth(fastify: FastifyInstance, password: string) {
    // Login page
    fastify.get('/login', async (_request, reply) => {
        reply.type('text/html').send(LOGIN_HTML.replace('{{error}}', ''));
    });

    // Login handler
    fastify.post('/login', async (request, reply) => {
        const body = request.body as { password?: string } | undefined;
        if (body?.password === password) {
            setSessionCookie(reply);
            reply.redirect('/');
        } else {
            reply.type('text/html').code(401).send(
                LOGIN_HTML.replace('{{error}}', '<p class="error">Wrong password</p>')
            );
        }
    });

    // Auth guard — skip login page and static assets
    fastify.addHook('onRequest', async (request, reply) => {
        const url = request.url;
        if (url === '/login' ||
            url.startsWith('/assets/') ||
            url === '/favicon.ico') {
            return;
        }
        if (!isAuthenticated(request)) {
            reply.redirect('/login');
        }
    });
}

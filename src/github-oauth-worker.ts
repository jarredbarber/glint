export interface Env {
    GITHUB_OAUTH_CLIENT_ID: string;
    GITHUB_OAUTH_CLIENT_SECRET: string;
    GITHUB_OAUTH_REDIRECT_URI: string;
    GITHUB_OAUTH_ALLOWED_ORIGINS: string;
}

type ExchangeRequest = { code: string; state: string };

function allowedOrigin(request: Request, env: Env): string | null {
    const origin = request.headers.get('Origin');
    if (!origin) return null;
    const allowed = env.GITHUB_OAUTH_ALLOWED_ORIGINS.split(',').map((value) => value.trim());
    return allowed.includes(origin) ? origin : null;
}

function headers(origin: string): Headers {
    return new Headers({
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Cache-Control': 'no-store',
        Vary: 'Origin',
        'Content-Type': 'application/json; charset=utf-8',
    });
}

function response(status: number, payload: Record<string, string>, origin: string): Response {
    return new Response(JSON.stringify(payload), { status, headers: headers(origin) });
}

async function exchange(request: Request, env: Env, origin: string): Promise<Response> {
    let body: unknown;
    try { body = await request.json(); } catch { return response(400, { error: 'invalid request' }, origin); }
    if (!body || typeof body !== 'object' || !('code' in body) || !('state' in body) || typeof body.code !== 'string' || typeof body.state !== 'string' || body.code.length === 0 || body.state.length === 0 || Object.keys(body).length !== 2) {
        return response(400, { error: 'invalid request' }, origin);
    }
    const requestBody: ExchangeRequest = { code: body.code, state: body.state };
    let upstream: Response;
    try {
        upstream = await fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: env.GITHUB_OAUTH_CLIENT_ID,
                client_secret: env.GITHUB_OAUTH_CLIENT_SECRET,
                code: requestBody.code,
                redirect_uri: env.GITHUB_OAUTH_REDIRECT_URI,
            }),
        });
    } catch {
        return response(502, { error: 'GitHub token exchange unavailable' }, origin);
    }
    let payload: unknown;
    try { payload = await upstream.json(); } catch { return response(502, { error: 'GitHub token exchange unavailable' }, origin); }
    if (!payload || typeof payload !== 'object') return response(502, { error: 'GitHub token exchange unavailable' }, origin);
    if ('access_token' in payload && typeof payload.access_token === 'string' && payload.access_token.length > 0) return response(200, { access_token: payload.access_token }, origin);
    if ('error' in payload && typeof payload.error === 'string') return response(upstream.ok ? 400 : upstream.status, { error: payload.error }, origin);
    return response(502, { error: 'GitHub token exchange unavailable' }, origin);
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
    const origin = allowedOrigin(request, env);
    if (!origin) return new Response(JSON.stringify({ error: 'origin not allowed' }), { status: 403, headers: { 'Cache-Control': 'no-store', Vary: 'Origin', 'Content-Type': 'application/json; charset=utf-8' } });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers(origin) });
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/exchange') return response(404, { error: 'not found' }, origin);
    return exchange(request, env, origin);
}

export default { fetch: handleRequest };

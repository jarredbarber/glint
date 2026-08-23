import assert from 'node:assert/strict';
import test from 'node:test';
import { Env, handleRequest } from '../github-oauth-worker.js';

const env: Env = {
    GITHUB_OAUTH_CLIENT_ID: 'client',
    GITHUB_OAUTH_CLIENT_SECRET: 'secret',
    GITHUB_OAUTH_REDIRECT_URI: 'https://glint.example/',
    GITHUB_OAUTH_ALLOWED_ORIGINS: 'https://glint.example,http://localhost:8080',
};

function request(method: string, body?: unknown, origin = 'https://glint.example'): Request {
    return new Request('https://worker.example/exchange', { method, headers: { Origin: origin, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
}

test('Worker rejects origins, methods, and malformed exchange bodies', async () => {
    assert.equal((await handleRequest(request('POST', { code: 'a', state: 'b' }, 'https://evil.example'), env)).status, 403);
    assert.equal((await handleRequest(request('GET'), env)).status, 404);
    assert.equal((await handleRequest(request('POST', { code: 'a' }), env)).status, 400);
    const preflight = await handleRequest(request('OPTIONS'), env);
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'https://glint.example');
    assert.equal(preflight.headers.get('Vary'), 'Origin');
});

test('Worker returns only a token from a successful fixed upstream exchange', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
        assert.equal(String(input), 'https://github.com/login/oauth/access_token');
        assert.equal(init?.method, 'POST');
        return new Response(JSON.stringify({ access_token: 'token', token_type: 'bearer' }), { headers: { 'Content-Type': 'application/json' } });
    };
    try {
        const response = await handleRequest(request('POST', { code: 'code', state: 'state' }), env);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { access_token: 'token' });
        assert.equal(response.headers.get('Cache-Control'), 'no-store');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

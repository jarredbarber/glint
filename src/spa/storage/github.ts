// GitHub backend: OAuth device flow (no client secret → works from static) + Contents API.
import { StorageAdapter, FileMeta, ConflictError } from './types.js';

const API = 'https://api.github.com';
const TOKEN_KEY = 'glint-gh-token';

// UTF-8-safe base64 (GitHub Contents API is base64).
function toB64(s: string): string {
    return btoa(String.fromCharCode(...new TextEncoder().encode(s)));
}
function fromB64(b: string): string {
    const bin = atob(b.replace(/\n/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export class GitHubAdapter implements StorageAdapter {
    private token: string | null = null;
    private userName = 'GitHub User';

    constructor(
        private owner: string,
        private repo: string,
        private path: string,
        private ref: string,
        private clientId: string,
    ) {
        if (!clientId) throw new Error('GitHub backend needs an OAuth App client ID (GLINT_CONFIG.githubClientId).');
    }

    async auth(): Promise<void> {
        const cached = localStorage.getItem(TOKEN_KEY);
        if (cached && (await this.validate(cached))) { this.token = cached; return; }
        this.token = await this.deviceFlow();
        localStorage.setItem(TOKEN_KEY, this.token);
        await this.validate(this.token);
    }

    private async validate(token: string): Promise<boolean> {
        try {
            const r = await fetch(`${API}/user`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } });
            if (!r.ok) return false;
            const u = await r.json();
            this.userName = u.name || u.login || this.userName;
            return true;
        } catch { return false; }
    }

    private async deviceFlow(): Promise<string> {
        const codeRes = await fetch('https://github.com/login/device/code', {
            method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ client_id: this.clientId, scope: 'repo' }),
        }).then((r) => r.json());
        const { device_code, user_code, verification_uri, interval } = codeRes;

        // Surface the code to the user (v1: alert is fine).
        alert(`Open ${verification_uri} and enter code:\n\n${user_code}\n\nThen return here — this dialog polls until you authorize.`);

        const pollEvery = ((interval ?? 5) + 1) * 1000;
        for (;;) {
            await new Promise((r) => setTimeout(r, pollEvery));
            const tok = await fetch('https://github.com/login/oauth/access_token', {
                method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ client_id: this.clientId, device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
            }).then((r) => r.json());
            if (tok.access_token) return tok.access_token;
            if (tok.error && tok.error !== 'authorization_pending' && tok.error !== 'slow_down') {
                throw new Error(`GitHub device flow: ${tok.error}`);
            }
        }
    }

    identity() { return { name: this.userName }; }

    private gh(path: string, opts: RequestInit = {}): Promise<Response> {
        return fetch(`${API}${path}`, {
            ...opts,
            headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json', ...(opts.headers || {}) },
        });
    }

    private fullPath(name: string): string {
        return this.path ? `${this.path.replace(/\/$/, '')}/${name}` : name;
    }

    async list(): Promise<FileMeta[]> {
        const r = await this.gh(`/repos/${this.owner}/${this.repo}/contents/${encodeURI(this.path)}?ref=${encodeURIComponent(this.ref)}`);
        if (!r.ok) throw new Error(`GitHub ${r.status}: ${await r.text()}`);
        const items = await r.json();
        return (items as any[])
            .filter((it) => it.type === 'file' && it.name.endsWith('.md'))
            .map((it) => ({ id: it.name, name: it.name, path: it.path, version: it.sha }));
    }

    async read(id: string) {
        const r = await this.gh(`/repos/${this.owner}/${this.repo}/contents/${encodeURI(this.fullPath(id))}?ref=${encodeURIComponent(this.ref)}`);
        if (!r.ok) throw new Error(`GitHub ${r.status}: ${await r.text()}`);
        const j = await r.json();
        return { content: fromB64(j.content), version: j.sha };
    }

    async write(id: string, content: string, version: string) {
        const r = await this.gh(`/repos/${this.owner}/${this.repo}/contents/${encodeURI(this.fullPath(id))}`, {
            method: 'PUT',
            body: JSON.stringify({
                message: `Update ${id} via Glint`,
                content: toB64(content),
                sha: version,
                branch: this.ref,
            }),
        });
        if (r.status === 409) throw new ConflictError();
        if (!r.ok) throw new Error(`GitHub ${r.status}: ${await r.text()}`);
        return { version: (await r.json()).content.sha };
    }
}

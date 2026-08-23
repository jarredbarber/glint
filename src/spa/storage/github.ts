// GitHub backend: fine-grained PAT (pasted once, cached in localStorage) + Contents API.
// Device flow was dropped: github.com/login/* sends no CORS headers, so token
// acquisition is browser-blocked. api.github.com does allow CORS, so read/write
// with a token works from the static page — the PAT is the zero-server path.
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
    ) {}

    async auth(): Promise<void> {
        const cached = localStorage.getItem(TOKEN_KEY);
        if (cached && (await this.validate(cached))) { this.token = cached; return; }
        const pat = prompt(
            'Paste a GitHub token with Contents read/write on this repo.\n' +
            'Fine-grained PAT (Repository access → Contents: Read and write), or a classic token with the "repo" scope.\n' +
            'Create one at github.com/settings/tokens'
        );
        const token = pat?.trim();
        if (!token) throw new Error('GitHub token required.');
        if (!(await this.validate(token))) throw new Error('Token is invalid or lacks access to this repo.');
        this.token = token;
        localStorage.setItem(TOKEN_KEY, token);
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

    async create(name: string, content: string): Promise<FileMeta> {
        const r = await this.gh(`/repos/${this.owner}/${this.repo}/contents/${encodeURI(this.fullPath(name))}`, {
            method: 'PUT',
            body: JSON.stringify({
                message: `Create ${name} via Glint`,
                content: toB64(content),
                branch: this.ref,
            }),
        });
        if (!r.ok) throw new Error(`GitHub ${r.status}: ${await r.text()}`);
        const { content: created } = await r.json();
        return { id: created.name, name: created.name, path: created.path, version: created.sha };
    }

    async delete(id: string): Promise<void> {
        const { version } = await this.read(id);
        const r = await this.gh(`/repos/${this.owner}/${this.repo}/contents/${encodeURI(this.fullPath(id))}`, {
            method: 'DELETE',
            body: JSON.stringify({
                message: `Delete ${id} via Glint`,
                sha: version,
                branch: this.ref,
            }),
        });
        if (!r.ok) throw new Error(`GitHub ${r.status}: ${await r.text()}`);
    }
}

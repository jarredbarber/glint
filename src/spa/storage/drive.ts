// Google Drive backend: GIS token client + Drive REST. Server-less, no client secret.
// REST calls are the ones proven by spike/drive-spa.html (issue #19, GREEN).
// Scope is `drive.file` (least privilege) per spec; if folder-child listing comes
// back empty under drive.file, widen SCOPE to `drive.readonly` + `drive.file` or
// `drive` (the documented tradeoff — spec §Risks) — a one-line change here.
import { StorageAdapter, FileMeta, ConflictError } from './types.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com';
const GIS_SRC = 'https://accounts.google.com/gsi/client';

declare const google: any;

function loadScript(src: string): Promise<void> {
    return new Promise((res, rej) => {
        if (document.querySelector(`script[src="${src}"]`)) return res();
        const s = document.createElement('script');
        s.src = src; s.async = true; s.defer = true;
        s.onload = () => res();
        s.onerror = () => rej(new Error(`failed to load ${src}`));
        document.head.appendChild(s);
    });
}

export class DriveAdapter implements StorageAdapter {
    private token: string | null = null;
    private userName = 'Drive User';

    constructor(private folderId: string, private clientId: string) {
        if (!clientId) throw new Error('Drive backend needs an OAuth client ID (GLINT_CONFIG.driveClientId).');
    }

    async auth(): Promise<void> {
        await loadScript(GIS_SRC);
        this.token = await new Promise<string>((resolve, reject) => {
            const client = google.accounts.oauth2.initTokenClient({
                client_id: this.clientId,
                scope: SCOPE,
                callback: (resp: any) => resp.access_token ? resolve(resp.access_token) : reject(new Error('no access token')),
            });
            client.requestAccessToken();
        });
        // Best-effort display name (userinfo is outside drive scope; ignore failures).
        try {
            const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: this.headers() });
            if (r.ok) this.userName = (await r.json()).name ?? this.userName;
        } catch { /* non-fatal */ }
    }

    identity() { return { name: this.userName }; }

    private headers(): Record<string, string> {
        if (!this.token) throw new Error('call auth() first');
        return { Authorization: `Bearer ${this.token}` };
    }

    private async api(path: string, opts: RequestInit = {}): Promise<Response> {
        const r = await fetch(API + path, { ...opts, headers: { ...this.headers(), ...(opts.headers || {}) } });
        if (!r.ok) throw new Error(`Drive ${r.status}: ${await r.text()}`);
        return r;
    }

    async list(): Promise<FileMeta[]> {
        const q = encodeURIComponent(`'${this.folderId}' in parents and name contains '.md' and trashed = false`);
        const r = await this.api(`/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&pageSize=100&orderBy=modifiedTime desc`);
        const { files } = await r.json();
        return (files as any[])
            .filter((f) => f.name.endsWith('.md'))
            .map((f) => ({ id: f.id, name: f.name, path: f.name, version: f.modifiedTime }));
    }

    async read(id: string) {
        const content = await (await this.api(`/drive/v3/files/${id}?alt=media`)).text();
        const { modifiedTime } = await (await this.api(`/drive/v3/files/${id}?fields=modifiedTime`)).json();
        return { content, version: modifiedTime };
    }

    async write(id: string, content: string, version: string) {
        const { modifiedTime } = await (await this.api(`/drive/v3/files/${id}?fields=modifiedTime`)).json();
        if (modifiedTime !== version) throw new ConflictError();
        const r = await this.api(`/upload/drive/v3/files/${id}?uploadType=media&fields=modifiedTime`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'text/markdown' },
            body: content,
        });
        return { version: (await r.json()).modifiedTime };
    }
}

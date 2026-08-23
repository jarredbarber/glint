// Google Drive backend: GIS token client + Drive REST. Server-less, no client secret.
// REST calls are the ones proven by spike/drive-spa.html (issue #19, GREEN).
// Scope is `drive.file` (least privilege) per spec; if folder-child listing comes
// back empty under drive.file, widen SCOPE to `drive.readonly` + `drive.file` or
// `drive` (the documented tradeoff — spec §Risks) — a one-line change here.
import { z } from 'zod';
import { StorageAdapter, FileMeta, ConflictError, AuthExpiredError } from './types.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com';
const GIS_SRC = 'https://accounts.google.com/gsi/client';

declare const google: {
    accounts: {
        oauth2: {
            initTokenClient(options: {
                client_id: string;
                scope: string;
                callback(response: unknown): void;
                error_callback(error: { type: string }): void;
            }): { requestAccessToken(options?: { prompt?: string }): void };
        };
    };
};

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const driveFileListSchema = z.object({
    files: z.array(z.object({
        id: z.string(),
        name: z.string(),
        mimeType: z.string(),
        modifiedTime: z.string().optional(),
    })).default([]),
    nextPageToken: z.string().optional(),
});

const tokenResponseSchema = z.object({ access_token: z.string().optional() });

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
        this.token = await this.requestToken('consent');
        // Best-effort display name (userinfo is outside drive scope; ignore failures).
        try {
            const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: this.headers() });
            if (r.ok) this.userName = (await r.json()).name ?? this.userName;
        } catch { /* non-fatal */ }
    }

    async reauthenticate(): Promise<void> {
        this.token = await this.requestToken('none');
    }

    private async requestToken(prompt: string): Promise<string> {
        await loadScript(GIS_SRC);
        return new Promise<string>((resolve, reject) => {
            const client = google.accounts.oauth2.initTokenClient({
                client_id: this.clientId,
                callback: (response: unknown) => {
                    const parsed = tokenResponseSchema.safeParse(response);
                    if (parsed.success && parsed.data.access_token) resolve(parsed.data.access_token);
                    else reject(new AuthExpiredError('Drive authentication expired'));
                },
                error_callback: () => reject(new AuthExpiredError('Drive authentication expired')),
                scope: SCOPE,
            });
            client.requestAccessToken({ prompt });
        });
    }

    identity() { return { name: this.userName }; }

    private headers(): Record<string, string> {
        if (!this.token) throw new Error('call auth() first');
        return { Authorization: `Bearer ${this.token}` };
    }

    private async api(path: string, opts: RequestInit = {}): Promise<Response> {
        const r = await fetch(API + path, { ...opts, headers: { ...this.headers(), ...(opts.headers || {}) } });
        if (r.status === 401) throw new AuthExpiredError('Drive authentication expired');
        if (!r.ok) throw new Error(`Drive ${r.status}: ${await r.text()}`);
        return r;
    }

    private async listFolder(folderId: string, prefix: string, visited: Set<string>): Promise<FileMeta[]> {
        if (visited.has(folderId)) return [];
        visited.add(folderId);
        const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
        const files: FileMeta[] = [];
        let pageToken: string | undefined;
        do {
            const token = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
            const response = await this.api(`/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,mimeType,modifiedTime)&pageSize=100&orderBy=name${token}`);
            const page = driveFileListSchema.parse(await response.json());
            for (const file of page.files) {
                const path = prefix ? `${prefix}/${file.name}` : file.name;
                if (file.mimeType === FOLDER_MIME_TYPE) {
                    files.push(...await this.listFolder(file.id, path, visited));
                } else if (file.name.endsWith('.md') && file.modifiedTime) {
                    files.push({ id: file.id, name: file.name, path, version: file.modifiedTime });
                }
            }
            pageToken = page.nextPageToken;
        } while (pageToken);
        return files;
    }

    async list(): Promise<FileMeta[]> {
        const files = await this.listFolder(this.folderId, '', new Set());
        return files.sort((a, b) => a.path.localeCompare(b.path));
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

    async create(name: string, content: string): Promise<FileMeta> {
        if ((await this.list()).some((file) => file.path === name)) {
            throw new Error(`file already exists: ${name}`);
        }
        const boundary = `glint-${crypto.randomUUID()}`;
        const metadata = JSON.stringify({ name, mimeType: 'text/markdown', parents: [this.folderId] });
        const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n${content}\r\n--${boundary}--`;
        const response = await this.api('/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime', {
            method: 'POST',
            headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
            body,
        });
        const created = await response.json();
        return { id: created.id, name: created.name, path: created.name, version: created.modifiedTime };
    }

    async delete(id: string): Promise<void> {
        await this.api(`/drive/v3/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
    }
}

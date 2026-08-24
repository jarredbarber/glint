// Google Drive backend: GIS token client + Drive REST. Server-less, no client secret.
// REST calls are the ones proven by spike/drive-spa.html (issue #19, GREEN).
// Scope is `drive.file` (least privilege) per spec; if folder-child listing comes
// back empty under drive.file, widen SCOPE to `drive.readonly` + `drive.file` or
// `drive` (the documented tradeoff — spec §Risks) — a one-line change here.
import { z } from 'zod';
import { StorageAdapter, FileMeta, ConflictError, AuthExpiredError, Discussion, DiscussionAnchor, DiscussionCapability, DiscussionReply } from './types.js';

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

const tokenResponseSchema = z.object({ access_token: z.string().optional(), expires_in: z.number().optional() });
const cachedTokenSchema = z.object({ token: z.string(), expiresAt: z.number() });

const driveAnchorSchema = z.object({
    version: z.literal(1),
    sourceLine: z.number().int().positive(),
    quote: z.string(),
    before: z.string().nullable(),
    after: z.string().nullable(),
});
const driveReplySchema = z.object({
    id: z.string(),
    content: z.string().default(''),
    createdTime: z.string().default(''),
    author: z.object({ displayName: z.string().optional() }).optional(),
});
const driveCommentSchema = z.object({
    id: z.string(),
    content: z.string().default(''),
    createdTime: z.string().default(''),
    resolved: z.boolean().default(false),
    anchor: z.string().optional(),
    author: z.object({ displayName: z.string().optional() }).optional(),
    replies: z.array(driveReplySchema).default([]),
});
const driveCommentListSchema = z.object({ comments: z.array(driveCommentSchema).default([]) });

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
    discussions: DiscussionCapability = {
        list: (fileId) => this.listDiscussions(fileId),
        create: (fileId, anchor, content) => this.createDiscussion(fileId, anchor, content),
        reply: (fileId, discussionId, content) => this.replyToDiscussion(fileId, discussionId, content),
        setResolved: (fileId, discussionId, resolved) => this.setDiscussionResolved(fileId, discussionId, resolved),
    };
    private userName = 'Drive User';

    constructor(private folderId: string, private clientId: string) {
        if (!clientId) throw new Error('Drive backend needs an OAuth client ID (GLINT_CONFIG.driveClientId).');
    }

    // ponytail: Drive tokens are drive.file-scoped and ~1h-lived, so persisting them
    // in localStorage skips the popup on every load/route click (#37). This deliberately
    // relaxes the #32/#38 no-storage rule — the real exfil control is the CSP, not token lifetime.
    private get storageKey(): string { return `glint.drive.token.${this.clientId}`; }

    private loadCachedToken(): string | null {
        try {
            const raw = localStorage.getItem(this.storageKey);
            if (!raw) return null;
            const parsed = cachedTokenSchema.safeParse(JSON.parse(raw));
            // 60s skew so a token about to expire isn't handed to a request mid-flight.
            if (parsed.success && parsed.data.expiresAt - 60_000 > Date.now()) return parsed.data.token;
            localStorage.removeItem(this.storageKey);
        } catch { /* no/blocked storage — fall through to interactive auth */ }
        return null;
    }

    private cacheToken(token: string, expiresAt: number): void {
        this.token = token;
        try { localStorage.setItem(this.storageKey, JSON.stringify({ token, expiresAt })); } catch { /* non-fatal */ }
    }

    private clearCachedToken(): void {
        this.token = null;
        try { localStorage.removeItem(this.storageKey); } catch { /* non-fatal */ }
    }

    async auth(): Promise<void> {
        const cached = this.loadCachedToken();
        if (cached) {
            this.token = cached;
        } else {
            // Silent grant first (no popup when a Google session already granted access),
            // interactive only when the silent request fails.
            try {
                await this.mintToken('none');
            } catch {
                await this.mintToken('');
            }
        }
        // Best-effort display name (userinfo is outside drive scope; ignore failures).
        try {
            const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: this.headers() });
            if (r.ok) this.userName = (await r.json()).name ?? this.userName;
        } catch { /* non-fatal */ }
    }

    async reauthenticate(): Promise<void> {
        await this.mintToken('none');
    }

    private async mintToken(prompt: string): Promise<void> {
        const { token, expiresAt } = await this.requestToken(prompt);
        this.cacheToken(token, expiresAt);
    }

    private async requestToken(prompt: string): Promise<{ token: string; expiresAt: number }> {
        await loadScript(GIS_SRC);
        return new Promise((resolve, reject) => {
            const client = google.accounts.oauth2.initTokenClient({
                client_id: this.clientId,
                callback: (response: unknown) => {
                    const parsed = tokenResponseSchema.safeParse(response);
                    if (parsed.success && parsed.data.access_token) {
                        const ttl = (parsed.data.expires_in ?? 3600) * 1000;
                        resolve({ token: parsed.data.access_token, expiresAt: Date.now() + ttl });
                    } else reject(new AuthExpiredError('Drive authentication expired'));
                },
                error_callback: () => reject(new AuthExpiredError('Drive authentication expired')),
                scope: SCOPE,
            });
            client.requestAccessToken({ prompt });
        });
    }

    capabilities() { return { canEdit: true, canComment: true }; }
    identity() { return { name: this.userName }; }

    private headers(): Record<string, string> {
        if (!this.token) throw new Error('call auth() first');
        return { Authorization: `Bearer ${this.token}` };
    }

    private async api(path: string, opts: RequestInit = {}): Promise<Response> {
        const r = await fetch(API + path, { ...opts, headers: { ...this.headers(), ...(opts.headers || {}) } });
        if (r.status === 401) { this.clearCachedToken(); throw new AuthExpiredError('Drive authentication expired'); }
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
    private mapComment(comment: z.infer<typeof driveCommentSchema>): Discussion {
        let anchor: DiscussionAnchor | null = null;
        if (comment.anchor) {
            try {
                const parsed = driveAnchorSchema.safeParse(JSON.parse(comment.anchor));
                anchor = parsed.success ? parsed.data : null;
            } catch {
                anchor = null;
            }
        }
        return {
            id: comment.id,
            content: comment.content,
            author: comment.author?.displayName ?? 'Drive user',
            createdAt: comment.createdTime,
            resolved: comment.resolved,
            anchor,
            replies: comment.replies.map((reply): DiscussionReply => ({
                id: reply.id,
                content: reply.content,
                author: reply.author?.displayName ?? 'Drive user',
                createdAt: reply.createdTime,
            })),
        };
    }

    private async listDiscussions(fileId: string): Promise<Discussion[]> {
        const fields = 'comments(id,content,createdTime,resolved,anchor,author(displayName),replies(id,content,createdTime,author(displayName)))';
        const response = await this.api(`/drive/v3/files/${encodeURIComponent(fileId)}/comments?fields=${encodeURIComponent(fields)}`);
        return driveCommentListSchema.parse(await response.json()).comments.map((comment) => this.mapComment(comment));
    }

    private async createDiscussion(fileId: string, anchor: DiscussionAnchor, content: string): Promise<Discussion> {
        const response = await this.api(`/drive/v3/files/${encodeURIComponent(fileId)}/comments?fields=id,content,createdTime,resolved,anchor,author(displayName),replies(id,content,createdTime,author(displayName))`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content, anchor: JSON.stringify(anchor), quotedFileContent: { mimeType: 'text/markdown', value: anchor.quote } }),
        });
        return this.mapComment(driveCommentSchema.parse(await response.json()));
    }

    private async replyToDiscussion(fileId: string, discussionId: string, content: string): Promise<DiscussionReply> {
        const response = await this.api(`/drive/v3/files/${encodeURIComponent(fileId)}/comments/${encodeURIComponent(discussionId)}/replies?fields=id,content,createdTime,author(displayName)`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content }),
        });
        const reply = driveReplySchema.parse(await response.json());
        return { id: reply.id, content: reply.content, author: reply.author?.displayName ?? 'Drive user', createdAt: reply.createdTime };
    }

    private async setDiscussionResolved(fileId: string, discussionId: string, resolved: boolean): Promise<void> {
        // Drive's `resolved` is output-only — PATCHing it 400s. A comment is
        // resolved/reopened by creating a reply with the matching action.
        await this.api(`/drive/v3/files/${encodeURIComponent(fileId)}/comments/${encodeURIComponent(discussionId)}/replies?fields=id,action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: resolved ? 'resolve' : 'reopen' }),
        });
    }
}

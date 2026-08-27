// Google Drive backend: GIS token client + Drive REST. Server-less, no client secret.
// REST calls are the ones proven by spike/drive-spa.html (issue #19, GREEN).
// Scope is `drive.file` (non-restricted): it only exposes files the app created or
// that the user hands over through the Google Picker. #83 widened to full `drive`
// so pre-existing folders would list, but full drive is a "restricted" scope needing
// an annual CASA security assessment to publish. #92 reverts to `drive.file` and uses
// the Picker as the sanctioned escape hatch: picking a folder authorizes it and
// cascades to every descendant, so a folder of markdown made elsewhere still lists.
import { z } from 'zod';
import { StorageAdapter, FileMeta, ConflictError, AuthExpiredError, Discussion, DiscussionAnchor, DiscussionCapability, DiscussionReply } from './types.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const PICKER_SRC = 'https://apis.google.com/js/api.js';

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
    picker: {
        ViewId: { FOLDERS: string };
        Action: { PICKED: string; CANCEL: string };
        DocsView: new (viewId: string) => {
            setSelectFolderEnabled(v: boolean): PickerDocsView;
            setIncludeFolders(v: boolean): PickerDocsView;
            setMimeTypes(v: string): PickerDocsView;
        };
        PickerBuilder: new () => PickerBuilder;
    };
};
declare const gapi: { load(name: string, cb: { callback: () => void } | (() => void)): void };
type PickerDocsView = InstanceType<typeof google.picker.DocsView>;
interface PickerBuilder {
    setOAuthToken(t: string): PickerBuilder;
    setDeveloperKey(k: string): PickerBuilder;
    setAppId(id: string): PickerBuilder;
    addView(v: PickerDocsView): PickerBuilder;
    setCallback(cb: (data: { action: string; docs?: { id: string }[] }) => void): PickerBuilder;
    build(): { setVisible(v: boolean): void };
}

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const driveFileListSchema = z.object({
    files: z.array(z.object({
        id: z.string(),
        name: z.string(),
        mimeType: z.string(),
        modifiedTime: z.string().optional(),
        owners: z.array(z.object({ displayName: z.string().optional() })).optional(),
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

function driveTokenKey(clientId: string): string { return `glint.drive.token.v3.${clientId}`; }

// Mint an OAuth access token via GIS. `prompt: 'none'` is a silent grant (no popup when a
// Google session already consented); '' shows the interactive consent/chooser.
function mintAccessToken(clientId: string, prompt: string): Promise<{ token: string; expiresAt: number }> {
    return loadScript(GIS_SRC).then(() => new Promise((resolve, reject) => {
        const client = google.accounts.oauth2.initTokenClient({
            client_id: clientId,
            scope: SCOPE,
            callback: (response: unknown) => {
                const parsed = tokenResponseSchema.safeParse(response);
                if (parsed.success && parsed.data.access_token) {
                    const ttl = (parsed.data.expires_in ?? 3600) * 1000;
                    resolve({ token: parsed.data.access_token, expiresAt: Date.now() + ttl });
                } else reject(new AuthExpiredError('Drive authentication expired'));
            },
            error_callback: () => reject(new AuthExpiredError('Drive authentication expired')),
        });
        client.requestAccessToken({ prompt });
    }));
}

let pickerReady: Promise<void> | null = null;
function loadPicker(): Promise<void> {
    if (!pickerReady) pickerReady = loadScript(PICKER_SRC).then(() => new Promise<void>((res) => gapi.load('picker', { callback: res })));
    return pickerReady;
}

// Open the Google Picker in folder-browse mode. Selecting a folder authorizes it (and its
// descendants) for the app under drive.file (#92). Resolves the picked folder id, or null on
// cancel. No pre-navigation: we don't know the target's parent, so the user browses from root.
// ponytail: no setParent pre-fill — its "select the folder you're inside" semantics are unclear
// (#92 open question); add when hunting for a deep folder is a real complaint.
async function pickDriveFolder(token: string, developerKey: string, appId: string): Promise<string | null> {
    await loadPicker();
    return new Promise((resolve) => {
        const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
            .setSelectFolderEnabled(true)
            .setIncludeFolders(true)
            .setMimeTypes(FOLDER_MIME_TYPE);
        new google.picker.PickerBuilder()
            .setOAuthToken(token)
            .setDeveloperKey(developerKey)
            .setAppId(appId)
            .addView(view)
            .setCallback((data) => {
                if (data.action === google.picker.Action.PICKED) resolve(data.docs?.[0]?.id ?? null);
                else if (data.action === google.picker.Action.CANCEL) resolve(null);
            })
            .build()
            .setVisible(true);
    });
}

// Landing "Open Google Drive" entry: mint a token, cache it under the shared key so the
// subsequent #/drive/<id> route reuses it, and browse for a folder. Returns its id or null.
export async function browseDriveFolder(clientId: string, pickerKey: string, appId: string): Promise<string | null> {
    if (!clientId) throw new Error('Drive needs an OAuth client ID (GLINT_CONFIG.driveClientId).');
    if (!pickerKey) throw new Error('Drive needs the Google Picker key (GLINT_CONFIG.drivePickerKey).');
    if (!appId) throw new Error('Drive needs the Google Cloud project number (GLINT_CONFIG.driveAppId).');
    const { token, expiresAt } = await mintAccessToken(clientId, '');
    try { localStorage.setItem(driveTokenKey(clientId), JSON.stringify({ token, expiresAt })); } catch { /* non-fatal */ }
    return pickDriveFolder(token, pickerKey, appId);
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
    private folderTitle = '';

    constructor(private folderId: string, private clientId: string, private pickerKey = '', private appId = '') {
        if (!clientId) throw new Error('Drive backend needs an OAuth client ID (GLINT_CONFIG.driveClientId).');
    }

    // ponytail: Drive tokens are ~1h-lived, so persisting them
    // in localStorage skips the popup on every load/route click (#37). This deliberately
    // relaxes the #32/#38 no-storage rule — the real exfil control is the CSP, not token lifetime.
    // v3: scope reverted to `drive.file` (#92); old full-`drive` tokens carry the
    // restricted scope we're shedding, so the suffix bump discards them and forces
    // fresh drive.file consent rather than letting them ride ~1h.
    private get storageKey(): string { return driveTokenKey(this.clientId); }

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

    private requestToken(prompt: string): Promise<{ token: string; expiresAt: number }> {
        return mintAccessToken(this.clientId, prompt);
    }

    capabilities() { return { canEdit: true, canComment: true }; }
    identity() { return { name: this.userName }; }
    folderName(): string | undefined { return this.folderTitle || undefined; }

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
            const response = await this.api(`/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,mimeType,modifiedTime,owners(displayName))&pageSize=100&orderBy=name${token}`);
            const page = driveFileListSchema.parse(await response.json());
            for (const file of page.files) {
                const path = prefix ? `${prefix}/${file.name}` : file.name;
                if (file.mimeType === FOLDER_MIME_TYPE) {
                    files.push(...await this.listFolder(file.id, path, visited));
                } else if (file.name.endsWith('.md') && file.modifiedTime) {
                    files.push({ id: file.id, name: file.name, path, version: file.modifiedTime, modifiedTime: file.modifiedTime, author: file.owners?.[0]?.displayName });
                }
            }
            pageToken = page.nextPageToken;
        } while (pageToken);
        return files;
    }

    async list(): Promise<FileMeta[]> {
        await this.ensureFolderAccess();
        const files = await this.listFolder(this.folderId, '', new Set());
        return files.sort((a, b) => a.path.localeCompare(b.path));
    }

    // drive.file gate (#92): under this scope the app can't see a folder from its id alone —
    // possessing a pasted/deep link does not authorize it. The Google Picker is the sanctioned
    // grant: picking the folder (or an ancestor) authorizes it and every descendant, and the
    // current token gains access immediately. Already-authorized folders probe visible and skip
    // the prompt. This is the single auth choke point for every #/drive/<id> entry.
    private async ensureFolderAccess(): Promise<void> {
        if (!this.folderId || await this.folderVisible(this.folderId)) return;
        if (!this.pickerKey) throw new Error('Drive folder access needs the Google Picker (GLINT_CONFIG.drivePickerKey).');
        if (!this.appId) throw new Error('Drive folder access needs the Google Cloud project number (GLINT_CONFIG.driveAppId).');
        const picked = await pickDriveFolder(this.token!, this.pickerKey, this.appId);
        if (picked === null) throw new Error('Drive access needs you to pick the folder. Reopen the link and choose it in the Google Picker.');
        if (!(await this.folderVisible(this.folderId))) {
            throw new Error('That was not the folder this link points to. Reopen the link and pick the linked folder, or a folder that contains it.');
        }
    }

    // A folder metadata probe: 200 = authorized (list will work), 404/403 = drive.file hides it
    // (needs a Picker grant). Goes through api() so tests stub it and 401 still expires the token.
    // Captures the folder's title so the project can be named after it (#100).
    private async folderVisible(id: string): Promise<boolean> {
        try {
            const res = await this.api(`/drive/v3/files/${encodeURIComponent(id)}?fields=id,name`);
            // Name capture is best-effort (#100): a missing/odd body must not fail the probe.
            if (id === this.folderId) {
                try { const meta = await res.json(); if (typeof meta?.name === 'string') this.folderTitle = meta.name; }
                catch { /* keep the id-based default */ }
            }
            return true;
        } catch (error) {
            if (error instanceof AuthExpiredError) throw error;
            if (/Drive 40[34]\b/.test((error as Error).message)) return false;
            throw error;
        }
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

    // Look up a single non-trashed child by name under a parent folder id.
    private async childId(parentId: string, name: string, folderOnly: boolean): Promise<string | null> {
        const clauses = [`'${parentId}' in parents`, `name = '${name.replace(/'/g, "\\'")}'`, 'trashed = false'];
        if (folderOnly) clauses.push(`mimeType = '${FOLDER_MIME_TYPE}'`);
        const q = encodeURIComponent(clauses.join(' and '));
        const r = await this.api(`/drive/v3/files?q=${q}&fields=files(id)&pageSize=1`);
        return (await r.json()).files?.[0]?.id ?? null;
    }

    private async resolveFolderId(folderPath: string): Promise<string> {
        let id = this.folderId;
        for (const seg of folderPath.split('/').filter(Boolean)) {
            const child = await this.childId(id, seg, true);
            if (!child) throw new Error(`No such folder: ${seg}`);
            id = child;
        }
        return id;
    }

    // Sidecar assets (#30/#70): create the image in the page's own parent folder (no
    // sidecar folder) via one multipart upload; read it back with alt=media as a Blob.
    async createAsset(path: string, content: Blob): Promise<void> {
        const segs = path.split('/').filter(Boolean);
        const name = segs.pop();
        if (!name) throw new Error('asset path is required');
        const parentId = await this.resolveFolderId(segs.join('/'));
        if (await this.childId(parentId, name, false)) throw new Error(`asset already exists: ${name}`);
        const boundary = `glint-${crypto.randomUUID()}`;
        const metadata = JSON.stringify({ name, mimeType: content.type, parents: [parentId] });
        const body = new Blob([
            `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${content.type}\r\n\r\n`,
            content,
            `\r\n--${boundary}--`,
        ]);
        await this.api('/upload/drive/v3/files?uploadType=multipart&fields=id', {
            method: 'POST',
            headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
            body,
        });
    }

    async readAsset(path: string): Promise<Blob> {
        const segs = path.split('/').filter(Boolean);
        const name = segs.pop();
        if (!name) throw new Error('asset path is required');
        const parentId = await this.resolveFolderId(segs.join('/'));
        const id = await this.childId(parentId, name, false);
        if (!id) throw new Error(`No such asset: ${path}`);
        return await (await this.api(`/drive/v3/files/${id}?alt=media`)).blob();
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

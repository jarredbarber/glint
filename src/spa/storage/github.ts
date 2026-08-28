// GitHub backend: OAuth or a fine-grained PAT cached in localStorage.
import { beginGitHubOAuth, GitHubOAuthConfig } from '../github-oauth.js';
import { z } from 'zod';
import { StorageAdapter, FileMeta, ConflictError, AuthExpiredError, isWikiFile } from './types.js';

const API = 'https://api.github.com';

// How saves reach GitHub (#60). direct = commit each save immediately (current).
// staged/pr = buffer edits in memory; push() flushes them as one commit (staged) or
// a branch + PR (pr). Owned here since it is a GitHub-write concern; app-state persists it.
export type GitHubPushMode = 'direct' | 'staged' | 'pr';

// How the adapter asks the UI for credentials, replacing the old prompt()/confirm().
// The result is a discriminated union: OAuth navigates away, PAT is validated in place.
export type GitHubAuthChoice = { kind: 'oauth' } | { kind: 'pat'; token: string } | null;
export type GitHubAuthPrompt = (ctx: {
    owner: string; repo: string; ref: string; hasOAuth: boolean; error?: string;
}) => Promise<GitHubAuthChoice>;

interface CachedRead {
    content: string;
    version: string;
}

const githubListSchema = z.array(z.object({
    type: z.string(),
    name: z.string(),
    path: z.string(),
    sha: z.string(),
}));
const githubTreeSchema = z.object({
    truncated: z.boolean(),
    tree: z.array(z.object({ path: z.string(), type: z.string(), sha: z.string() })),
});
const githubReadSchema = z.object({ content: z.string(), sha: z.string() });
const githubMutationSchema = z.object({
    content: z.object({ name: z.string(), path: z.string(), sha: z.string() }),
});
// ponytail: mirror the Drive token cache (#37/#53) — persist the validated token in
// localStorage so reopening an authed repo skips the auth window. Same tradeoff: the
// CSP is the real exfil control, and 401/invalid clears it. Global key: validate() and
// the 401 handlers cover a token that lacks access to a particular repo.
const GH_TOKEN_KEY = 'glint.github.token';
function loadCachedGitHubToken(): string | null {
    try { return localStorage.getItem(GH_TOKEN_KEY) || null; } catch { return null; }
}
function cacheGitHubToken(token: string): void {
    try { localStorage.setItem(GH_TOKEN_KEY, token); } catch { /* non-fatal */ }
}
function clearCachedGitHubToken(): void {
    try { localStorage.removeItem(GH_TOKEN_KEY); } catch { /* non-fatal */ }
}
// Exposed so Settings can honor the "sign out" affordance the disclosure promises (#65).
export function hasCachedGitHubToken(): boolean {
    try { return !!localStorage.getItem(GH_TOKEN_KEY); } catch { return false; }
}
export function forgetGitHubToken(): void { clearCachedGitHubToken(); }

// UTF-8-safe base64 (GitHub Contents API is base64).
function toB64(s: string): string {
    return bytesToB64(new TextEncoder().encode(s));
}
function fromB64(b: string): string {
    const bin = atob(b.replace(/\n/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

// Base64 of arbitrary bytes (GitHub Contents API is base64), chunked so a 5 MB image
// doesn't blow the argument limit of String.fromCharCode(...spread).
function bytesToB64(bytes: Uint8Array): string {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
}

export class GitHubAdapter implements StorageAdapter {
    private token: string | null = null;
    private userName = 'GitHub User';
    // Optimistic until the repo's permissions are fetched (#59): a read-only token
    // then flips this false and the UI hides Save; a failed probe leaves writes to 403.
    private canPush = true;
    private reads = new Map<string, CachedRead>();
    private listedVersions = new Map<string, string>();
    // Push-mode state (#60): in staged/pr, write() parks edits here (id -> latest content
    // + the sha it was based on) instead of committing. push() drains it.
    private mode: GitHubPushMode = 'direct';
    private pending = new Map<string, { content: string; base: string }>();

    constructor(
        private owner: string,
        private repo: string,
        private path: string,
        private ref: string,
        private oauth?: GitHubOAuthConfig,
        initialToken?: string | null,
        private authPrompt?: GitHubAuthPrompt,
    ) {
        this.token = initialToken ?? loadCachedGitHubToken();
    }

    // The branch actually in use after auth() resolves the default (#64/#67). Used to build
    // blob share links that name a concrete branch even when the route left it implicit.
    get resolvedRef(): string { return this.ref; }

    // github.com blob URL for a source-root-relative page path, for an "Open on
    // GitHub" link on each rendered page (#69).
    pageUrl(pathRel: string): string {
        const full = this.fullPath(pathRel).split('/').map(encodeURIComponent).join('/');
        return `https://github.com/${this.owner}/${this.repo}/blob/${encodeURIComponent(this.ref)}/${full}`;
    }

    async auth(): Promise<void> {
        if (this.token && (await this.validate(this.token))) { cacheGitHubToken(this.token); await this.probeRepo(); return; }
        clearCachedGitHubToken();
        let error: string | undefined;
        for (;;) {
            const choice = this.authPrompt
                ? await this.authPrompt({ owner: this.owner, repo: this.repo, ref: this.ref || 'default branch', hasOAuth: !!this.oauth, error })
                : null;
            if (!choice) throw new Error('GitHub token required.');
            if (choice.kind === 'oauth') {
                if (this.oauth) { beginGitHubOAuth(this.oauth); return await new Promise<void>(() => {}); }
                error = 'GitHub sign-in is not configured here — paste a token instead.';
                continue;
            }
            const token = choice.token.trim();
            if (token && (await this.validate(token))) { this.token = token; cacheGitHubToken(token); await this.probeRepo(); return; }
            error = 'That token is invalid or lacks access to this repo.';
        }
    }

    async reauthenticate(): Promise<void> {
        if (!this.token || !(await this.validate(this.token))) {
            clearCachedGitHubToken();
            throw new AuthExpiredError('GitHub authentication expired');
        }
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

    // One repo fetch that yields both write access (`permissions.push`) and the default
    // branch. When no ref was given in the URL (this.ref is ''), adopt the repo's default
    // branch instead of assuming `main` (#64: repos on `master` etc). An explicit @ref wins.
    private async probeRepo(): Promise<void> {
        try {
            const r = await this.gh(`/repos/${this.owner}/${this.repo}`);
            if (r.ok) {
                const j = await r.json();
                this.canPush = !!j?.permissions?.push;
                if (!this.ref) this.ref = j?.default_branch || 'main';
            }
        } catch { /* keep optimistic default; a write will 403 if wrong */ }
        if (!this.ref) this.ref = 'main';   // fallback if the probe failed
    }

    capabilities() { return { canEdit: this.canPush, canComment: false }; }
    identity() { return { name: this.userName }; }

    // Push-mode surface (#60). Only edits (write) are staged; create/delete/asset stay
    // direct so a pasted image exists before the Markdown that references it is committed.
    setPushMode(mode: GitHubPushMode): void { this.mode = mode; }
    pushMode(): GitHubPushMode { return this.mode; }
    pendingCount(): number { return this.pending.size; }

    private gh(path: string, opts: RequestInit = {}): Promise<Response> {
        return fetch(`${API}${path}`, {
            ...opts,
            headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json', ...(opts.headers || {}) },
        });
    }

    private fullPath(name: string): string {
        const root = this.path.replace(/^\/+|\/+$/g, '');
        return root ? (name ? `${root}/${name}` : root) : name;
    }

    private async listDirectory(path: string): Promise<FileMeta[]> {
        const r = await this.gh(`/repos/${this.owner}/${this.repo}/contents/${encodeURI(this.fullPath(path))}?ref=${encodeURIComponent(this.ref)}`);
        if (!r.ok) throw new Error(`GitHub ${r.status}: ${await r.text()}`);
        const items = githubListSchema.parse(await r.json());
        const files: FileMeta[] = [];
        for (const item of items) {
            const relativePath = path ? `${path}/${item.name}` : item.name;
            if (item.type === 'dir') {
                files.push(...await this.listDirectory(relativePath));
            } else if (item.type === 'file' && isWikiFile(item.name)) {
                files.push({ id: relativePath, name: item.name, path: relativePath, version: item.sha });
            }
        }
        return files;
    }

    // One recursive Git Trees call yields the whole repo tree, instead of one
    // /contents/ request per directory (#66). Returns null when GitHub truncates
    // the tree (>100k entries) or the call fails, so list() falls back to the walk.
    // ponytail: no author/modifiedTime (#87) — the tree/contents API omits them;
    // each would need a per-file commit lookup. Add via the commits API if wanted.
    private async listTree(): Promise<FileMeta[] | null> {
        const r = await this.gh(`/repos/${this.owner}/${this.repo}/git/trees/${encodeURIComponent(this.ref)}?recursive=1`);
        if (!r.ok) return null;
        const j = githubTreeSchema.parse(await r.json());
        if (j.truncated) return null;
        const root = this.path.replace(/^\/+|\/+$/g, '');
        const prefix = root ? `${root}/` : '';
        const files: FileMeta[] = [];
        for (const item of j.tree) {
            if (item.type !== 'blob' || !isWikiFile(item.path)) continue;
            if (prefix && !item.path.startsWith(prefix)) continue;
            const rel = item.path.slice(prefix.length);
            files.push({ id: rel, name: rel.split('/').pop()!, path: rel, version: item.sha });
        }
        return files;
    }

    async list(): Promise<FileMeta[]> {
        const files = (await this.listTree()) ?? await this.listDirectory('');
        this.listedVersions = new Map(files.map((file) => [file.id, file.version]));
        for (const id of this.reads.keys()) {
            if (!this.listedVersions.has(id)) this.reads.delete(id);
        }
        return files.sort((a, b) => a.path.localeCompare(b.path));
    }

    async read(id: string) {
        const cached = this.reads.get(id);
        const listedVersion = this.listedVersions.get(id);
        if (cached && (!listedVersion || cached.version === listedVersion)) return cached;
        const r = await this.gh(`/repos/${this.owner}/${this.repo}/contents/${encodeURI(this.fullPath(id))}?ref=${encodeURIComponent(this.ref)}`);
        if (!r.ok) throw new Error(`GitHub ${r.status}: ${await r.text()}`);
        const j = githubReadSchema.parse(await r.json());
        const read = { content: fromB64(j.content), version: j.sha };
        this.reads.set(id, read);
        this.listedVersions.set(id, read.version);
        return read;
    }

    async write(id: string, content: string, version: string) {
        if (this.mode !== 'direct') {
            // Buffer: keep the earliest base sha, serve the edited text on re-open via the
            // read cache (version unchanged, so the cache stays valid), commit later in push().
            const base = this.pending.get(id)?.base ?? version;
            this.pending.set(id, { content, base });
            this.reads.set(id, { content, version });
            return { version };
        }
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
        if (r.status === 401) { clearCachedGitHubToken(); throw new AuthExpiredError('GitHub authentication expired'); }
        if (!r.ok) throw new Error(`GitHub ${r.status}: ${await r.text()}`);
        const nextVersion = githubMutationSchema.parse(await r.json()).content.sha;
        this.reads.set(id, { content, version: nextVersion });
        this.listedVersions.set(id, nextVersion);
        return { version: nextVersion };
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
        const created = githubMutationSchema.parse(await r.json()).content;
        const file = { id: name, name: name.split('/').pop()!, path: name, version: created.sha };
        this.reads.set(file.id, { content, version: file.version });
        this.listedVersions.set(file.id, file.version);
        return file;
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
        this.reads.delete(id);
        this.listedVersions.delete(id);
    }

    // Flush all staged edits (#60) as one commit via the Git Data API (the Contents API is
    // one-file-per-commit). staged commits onto the working branch; pr commits onto a fresh
    // branch and opens a PR against it. Pending stays intact on failure so the user can retry.
    async push(message: string): Promise<{ commit?: string; prUrl?: string }> {
        const entries = [...this.pending.entries()];
        if (entries.length === 0) return {};
        const repo = `/repos/${this.owner}/${this.repo}`;
        const headSha: string = (await this.ghJson(`${repo}/git/ref/heads/${encodeURIComponent(this.ref)}`)).object.sha;
        const baseTree: string = (await this.ghJson(`${repo}/git/commits/${headSha}`)).tree.sha;
        const tree = [];
        for (const [id, { content }] of entries) {
            const blob: string = (await this.ghJson(`${repo}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: toB64(content), encoding: 'base64' }) })).sha;
            tree.push({ path: this.fullPath(id), mode: '100644', type: 'blob', sha: blob });
        }
        const newTree: string = (await this.ghJson(`${repo}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: baseTree, tree }) })).sha;
        const commit: string = (await this.ghJson(`${repo}/git/commits`, { method: 'POST', body: JSON.stringify({ message, tree: newTree, parents: [headSha] }) })).sha;
        let result: { commit?: string; prUrl?: string };
        if (this.mode === 'pr') {
            // ponytail: auto-named branch off the working ref, no picker; add naming/base UX if asked.
            const branch = `glint/${Date.now()}`;
            await this.ghJson(`${repo}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit }) });
            const prUrl: string = (await this.ghJson(`${repo}/pulls`, { method: 'POST', body: JSON.stringify({ title: message, head: branch, base: this.ref, body: 'Opened by Glint.' }) })).html_url;
            result = { prUrl };
        } else {
            await this.ghJson(`${repo}/git/refs/heads/${encodeURIComponent(this.ref)}`, { method: 'PATCH', body: JSON.stringify({ sha: commit }) });
            result = { commit };
        }
        // Drop caches for pushed files so the next read fetches their fresh shas.
        for (const [id] of entries) { this.pending.delete(id); this.reads.delete(id); this.listedVersions.delete(id); }
        return result;
    }

    private async ghJson(path: string, opts: RequestInit = {}): Promise<any> {
        const r = await this.gh(path, opts);
        if (r.status === 401) { clearCachedGitHubToken(); throw new AuthExpiredError('GitHub authentication expired'); }
        if (!r.ok) throw new Error(`GitHub ${r.status}: ${await r.text()}`);
        return r.json();
    }

    // Sidecar assets (#30/#70): create-only commit (no sha → 422 if it already exists),
    // raw read. Image upload and Markdown save are deliberately separate commits.
    async createAsset(path: string, content: Blob): Promise<void> {
        const b64 = bytesToB64(new Uint8Array(await content.arrayBuffer()));
        const r = await this.gh(`/repos/${this.owner}/${this.repo}/contents/${encodeURI(this.fullPath(path))}`, {
            method: 'PUT',
            body: JSON.stringify({ message: `Add ${path} via Glint`, content: b64, branch: this.ref }),
        });
        if (r.status === 401) { clearCachedGitHubToken(); throw new AuthExpiredError('GitHub authentication expired'); }
        if (r.status === 422) throw new Error(`asset already exists: ${path}`);
        if (!r.ok) throw new Error(`GitHub ${r.status}: ${await r.text()}`);
    }

    async readAsset(path: string): Promise<Blob> {
        const r = await this.gh(`/repos/${this.owner}/${this.repo}/contents/${encodeURI(this.fullPath(path))}?ref=${encodeURIComponent(this.ref)}`, {
            headers: { Accept: 'application/vnd.github.raw' },
        });
        if (r.status === 401) { clearCachedGitHubToken(); throw new AuthExpiredError('GitHub authentication expired'); }
        if (!r.ok) throw new Error(`GitHub ${r.status}: ${await r.text()}`);
        return await r.blob();
    }
}

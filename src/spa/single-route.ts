// Route parsing/building for single-file share links and pasted URLs. Pure functions,
// kept out of app.ts so they stay Node-testable.
//
// GitHub routes mirror github.com's own URL shape (#67):
//   #/gh/<owner>/<repo>                     project root, default branch
//   #/gh/<owner>/<repo>/tree/<ref>/<path>   project subtree
//   #/gh/<owner>/<repo>/blob/<ref>/<path>   single file  ('blob' triggers single-file mode)
// Legacy `#/gh/<owner>/<repo>/<path>[@ref]` still opens as a project.
// Drive/demo single files keep the `#/s/<backend>/…` form.

const splitHash = (hash: string): string[] =>
    hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);

const encPath = (s: string) => s.split('/').filter(Boolean).map(encodeURIComponent).join('/');

export interface GhTarget { owner: string; repo: string; ref: string; path: string; mode: 'blob' | 'tree'; }

// Parse the segments after `gh`/`github`.
export function parseGhRoute(rest: string[]): GhTarget {
    const [owner, repo, marker, ...tail] = rest;
    if (!owner || !repo) throw new Error('GitHub links need owner/repo.');
    if (marker === 'blob' || marker === 'tree') {
        const ref = tail[0] ?? '';
        const path = tail.slice(1).join('/');
        if (marker === 'blob' && !path) throw new Error('Single-file link needs a file path.');
        return { owner, repo, ref, path, mode: marker };
    }
    // Legacy form: everything after repo is the path, optional @ref on the last segment.
    let path = [marker, ...tail].filter(Boolean).join('/');
    let ref = '';
    const at = path.lastIndexOf('@');
    if (at !== -1) { ref = path.slice(at + 1); path = path.slice(0, at); }
    return { owner, repo, ref, path, mode: 'tree' };
}

// Parse the tail after `s` for the drive/demo single-file form (gh single files now use
// the `#/gh/.../blob/...` route above; this stays for back-compat with old gh share links).
export function parseSingleRoute(rest: string[]): { backend: string; owner?: string; repo?: string; ref: string; path: string } {
    const backend = rest[0] ?? '';
    const args = rest.slice(1);
    if (backend === 'gh' || backend === 'github') {
        const t = parseGhRoute(args);
        if (!t.path) throw new Error('Single-file link needs owner/repo/path.');
        return { backend: 'gh', owner: t.owner, repo: t.repo, ref: t.ref, path: t.path };
    }
    if (backend === 'drive') {
        const id = args[0];
        if (!id) throw new Error('Single-file Drive link needs a file id.');
        return { backend: 'drive', ref: '', path: id };
    }
    if (backend === 'demo') {
        const path = args.join('/');
        if (!path) throw new Error('Single-file demo link needs a page name.');
        return { backend: 'demo', ref: 'main', path };
    }
    throw new Error(`Single-file links are not supported for “${backend}”.`);
}

// Build the share route for `pagePath` (source-root relative) out of the current project
// route. `refOverride` is the adapter's resolved default branch (gh needs a concrete branch
// in the blob URL even when the project route left it implicit, #64/#67). Returns null for
// backends with no URL identity (local) or opaque file ids (drive).
export function buildShareRoute(projectRoute: string, pagePath: string, refOverride?: string): string | null {
    const parts = splitHash(projectRoute);
    const backend = parts[0];
    const rest = parts.slice(1);
    if (backend === 'gh' || backend === 'github') {
        const t = parseGhRoute(rest);
        const full = [t.path, pagePath].filter(Boolean).join('/');
        // An explicit ref in the project route is intentional and must round-trip;
        // refOverride only fills in when the route left the ref implicit (#64/#65).
        const ref = t.ref || refOverride || 'main';
        return `#/gh/${encodeURIComponent(t.owner)}/${encodeURIComponent(t.repo)}/blob/${encodeURIComponent(ref)}/${encPath(full)}`;
    }
    if (backend === 'demo') return `#/s/demo/${encPath(pagePath)}`;
    return null;
}

// A project route can carry the currently-open page as a trailing `/-/<path>` suffix so the
// URL bar reflects and reloads to that page (#69). `-` is the marker (unlike `blob`, which
// opens a read-only single file); a bare `-` segment never appears in a real source path.
export function splitPageRoute(hash: string): { projectRoute: string; pagePath: string | null } {
    const parts = splitHash(hash);
    const i = parts.indexOf('-');
    if (i === -1) return { projectRoute: hash, pagePath: null };
    const page = parts.slice(i + 1).join('/');
    return {
        projectRoute: '#/' + parts.slice(0, i).map(encodeURIComponent).join('/'),
        pagePath: page || null,
    };
}

export function buildPageRoute(projectRoute: string, pagePath: string): string {
    return `${projectRoute}/-/${encPath(pagePath)}`;
}

// Which page to open after listing a project (#69, #142). An explicit `/-/<path>` in
// the route wins; if that path isn't in the listing, `pageMissing` flags it so the
// caller can say so instead of silently opening the first file (the #142 symptom —
// a deep page that failed to list would quietly land on files[0]). With no explicit
// page, reopen the page you left in the same project, else the first file.
export function resolveReopen(
    files: readonly { id: string; path: string }[],
    pagePath: string | null,
    sameProject: boolean,
    lastFileId: string | null,
): { id: string | undefined; pageMissing: boolean } {
    if (pagePath) {
        const byPath = files.find((f) => f.path === pagePath);
        if (byPath) return { id: byPath.id, pageMissing: false };
        return { id: files[0]?.id, pageMissing: true };
    }
    const id = sameProject && lastFileId && files.some((f) => f.id === lastFileId) ? lastFileId : files[0]?.id;
    return { id, pageMissing: false };
}

// True when `parent` is a proper ancestor of `child` (same leading segments, strictly
// shorter). Used to keep subtrees/subfolders out of the project list when a containing
// project is already saved (#130): a GitHub repo root contains its subtrees.
export function routeContains(parent: string, child: string): boolean {
    const p = splitHash(parent), c = splitHash(child);
    if (p.length === 0 || p.length >= c.length) return false;
    return p.every((seg, i) => seg === c[i]);
}

// Detect a service from a pasted URL or short form and return the hash route it opens (#67).
// Accepts github.com blob/tree URLs, `owner/repo[/...]` short forms, and Drive folder/file
// URLs or bare ids. Returns null when nothing recognizable is present.
export function parseLandingUrl(raw: string): string | null {
    const value = raw.trim();
    if (!value) return null;

    // GitHub web URLs: github.com/owner/repo[/(blob|tree)/ref/path...]
    const gh = value.match(/github\.com\/([^/]+)\/([^/?#]+)(?:\/(blob|tree)\/([^/]+)((?:\/[^?#]*)?))?/i);
    if (gh) {
        const [, owner, repoRaw, marker, ref, pathRaw] = gh;
        const repo = repoRaw.replace(/\.git$/, '');
        const path = (pathRaw ?? '').replace(/^\/+|\/+$/g, '');
        if (marker && path) return `#/gh/${owner}/${repo}/${marker}/${ref}/${encPath(path)}`;
        return `#/gh/${owner}/${repo}`;
    }

    // Drive: a single file (…/file/d/<id>…) opens read-only; a folder opens as a project.
    const driveFile = value.match(/\/file\/d\/([^/?#]+)/);
    if (driveFile) return `#/s/drive/${encodeURIComponent(driveFile[1])}`;
    const driveFolder = value.match(/\/folders\/([^/?#]+)/);
    if (driveFolder) return `#/drive/${encodeURIComponent(driveFolder[1])}`;

    // Short forms without a host: `owner/repo/blob/ref/path`, `owner/repo`, etc.
    const clean = value.replace(/^\/+/, '');
    if (/^[^/\s]+\/[^/\s]+/.test(clean)) return `#/gh/${clean}`;

    return null;
}

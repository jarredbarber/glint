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
        const ref = refOverride || t.ref || 'main';
        return `#/gh/${encodeURIComponent(t.owner)}/${encodeURIComponent(t.repo)}/blob/${encodeURIComponent(ref)}/${encPath(full)}`;
    }
    if (backend === 'demo') return `#/s/demo/${encPath(pagePath)}`;
    return null;
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

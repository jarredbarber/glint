// Single-file share links (#58): `#/s/<backend>/<address>` renders one document with no
// project tree. Pure route parsing/building, kept out of app.ts so it is Node-testable.

const splitHash = (hash: string): string[] =>
    hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);

// Parse the tail after `s`. For gh the file path is repo-root relative (source root is the
// whole repo), so the adapter's `read(path)` fetches it without a recursive listing.
export function parseSingleRoute(rest: string[]): { backend: string; owner?: string; repo?: string; ref: string; path: string } {
    const backend = rest[0] ?? '';
    const args = rest.slice(1);
    if (backend === 'gh' || backend === 'github') {
        const [owner, repo, ...pathParts] = args;
        let ref = '';   // '' = auto-detect the repo's default branch (#64)
        let path = pathParts.join('/');
        const at = path.lastIndexOf('@');
        if (at !== -1) { ref = path.slice(at + 1); path = path.slice(0, at); }
        if (!owner || !repo || !path) throw new Error('Single-file link needs owner/repo/path.');
        return { backend: 'gh', owner, repo, ref, path };
    }
    if (backend === 'demo') {
        const path = args.join('/');
        if (!path) throw new Error('Single-file demo link needs a page name.');
        return { backend: 'demo', ref: 'main', path };
    }
    throw new Error(`Single-file links are not supported for “${backend}”.`);
}

// Inverse: build the `#/s/…` route that shares `pagePath` (source-root relative) out of the
// given project route. Returns null for backends with no URL identity (local) or opaque
// file ids (drive).
export function buildShareRoute(projectRoute: string, pagePath: string): string | null {
    const parts = splitHash(projectRoute);
    const backend = parts[0];
    const rest = parts.slice(1);
    const enc = (s: string) => s.split('/').filter(Boolean).map(encodeURIComponent).join('/');
    if (backend === 'gh' || backend === 'github') {
        const [owner, repo, ...rootParts] = rest;
        if (!owner || !repo) return null;
        let ref = 'main';
        let root = rootParts.join('/');
        const at = root.lastIndexOf('@');
        if (at !== -1) { ref = root.slice(at + 1) || 'main'; root = root.slice(0, at); }
        const full = [root, pagePath].filter(Boolean).join('/');
        const suffix = ref && ref !== 'main' ? `@${encodeURIComponent(ref)}` : '';
        return `#/s/gh/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${enc(full)}${suffix}`;
    }
    if (backend === 'demo') return `#/s/demo/${enc(pagePath)}`;
    return null;
}

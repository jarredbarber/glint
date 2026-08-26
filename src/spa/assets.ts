// Portable image assets (#30/#70): flat sidecars named <page-filename>.<shortid>.<ext>,
// stored beside the page. Markdown keeps a backend-neutral, page-relative reference; the
// adapter seam (createAsset/readAsset) hides every backend's file mechanics.

export const MAX_ASSET_BYTES = 5_000_000;

// Accepted paste types → canonical extension. SVG is intentionally excluded (design §Paste).
export const ASSET_MIME_EXT: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
};

// 8 lowercase hex chars (32 bits) from the CSPRNG. Create-only writes turn any clash
// into a visible failure rather than an overwrite, so this is ample.
export function shortId(): string {
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// A managed src is a page-relative reference the SPA resolves through the adapter, as
// opposed to an external/data/absolute URL the renderer leaves alone.
export function isManagedSrc(src: string): boolean {
    return !!src && !/^([a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(src);
}

// Normalize a page-relative reference to a workspace-root-relative POSIX path, resolving
// `.`/`..` against the page's parent. Returns null for anything that escapes the root or
// is not a plain relative path (NUL, backslash, absolute, scheme, protocol-relative).
export function resolveAssetPath(pagePath: string, relSrc: string): string | null {
    let src: string;
    try { src = decodeURIComponent(relSrc); } catch { return null; }
    if (!src || src.includes('\0') || src.includes('\\')) return null;
    if (!isManagedSrc(src)) return null;
    const out = pagePath.split('/').filter(Boolean).slice(0, -1);   // page parent segments
    for (const seg of src.split('/')) {
        if (seg === '' || seg === '.') continue;
        if (seg === '..') { if (!out.length) return null; out.pop(); continue; }
        out.push(seg);
    }
    if (!out.length || !out[out.length - 1]) return null;
    return out.join('/');
}

// Paste target: a sibling of the page named <pageBasename>.<shortid>.<ext>. Returns the
// workspace-relative path to write and the page-relative reference to put in Markdown.
export function derivePastePath(pagePath: string, ext: string): { assetPath: string; ref: string } {
    const segs = pagePath.split('/').filter(Boolean);
    const base = segs[segs.length - 1] ?? 'page.md';
    const ref = `${base}.${shortId()}.${ext}`;
    segs[segs.length - 1] = ref;
    return { assetPath: segs.join('/'), ref };
}

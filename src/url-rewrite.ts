import path from 'node:path';

/**
 * Rewrites server-relative app URLs in rendered HTML into static equivalents
 * for a directory-per-page build. Pure: no I/O.
 *
 * - /f/<p>(.md)(?query)      -> /<p-without-.md>/
 * - /api/asset/resolve?...   -> /<join(dirname(context), path)>
 * - everything else          -> unchanged
 */
export function rewriteStaticHtml(html: string): string {
    // Rewrite asset resolver URLs first (they contain query strings).
    html = html.replace(
        /\/api\/asset\/resolve\?([^"'\s>]+)/g,
        (_full, query: string) => {
            // rehype-stringify may serialize '&' as '&amp;' or as a numeric
            // entity ('&#x26;' / '&#38;'); normalize all forms before parsing.
            const decodedQuery = query
                .replace(/&amp;/g, '&')
                .replace(/&#x26;/gi, '&')
                .replace(/&#38;/g, '&');
            const params = new URLSearchParams(decodedQuery);
            const assetPath = params.get('path') || '';
            const context = params.get('context') || '';
            if (!assetPath) return _full;
            const clean = assetPath.replace(/^\.\//, '');
            let target: string;
            if (clean.startsWith('/')) {
                target = clean; // already absolute (uploaded-image case)
            } else if (context) {
                target = '/' + path.posix.join(path.posix.dirname(context), clean);
            } else {
                target = '/' + clean;
            }
            return target;
        }
    );

    // Rewrite /f/ page links (href or src), with optional .md and query.
    html = html.replace(
        /(href|src)="\/f\/([^"?#]*?)(?:\.md)?(?:\?[^"#]*)?(#[^"]*)?"/g,
        (_full, attr: string, p: string, hash = '') => {
            const clean = p.replace(/\/+$/, '');
            return `${attr}="/${clean}/${hash}"`;
        }
    );

    return html;
}

/**
 * Prepends a base-path prefix to every root-absolute href/src in the HTML so a
 * directory-per-page build can be hosted under a subpath (e.g. foo.com/wiki).
 * Pure. Only touches single-leading-slash URLs — leaves "//cdn", "https://…",
 * "#anchor", "mailto:", and already-relative URLs alone.
 *
 *   applyPrefix('<a href="/foo/">', '/wiki') -> '<a href="/wiki/foo/">'
 *   applyPrefix('<a href="/">', 'wiki')      -> '<a href="/wiki/">'
 *
 * This rewrites HTML attributes only, which is sufficient for the static
 * output: the kept client bundles construct no absolute URLs, the theme
 * switcher derives its stylesheet URL from the (already-prefixed) <link> href,
 * and the bundled CSS uses only relative url(...) references.
 */
/**
 * Swaps the self-hosted KaTeX stylesheet link for the jsDelivr CDN copy at the
 * given version. The CDN serves the CSS and its fonts with
 * `Access-Control-Allow-Origin: *`, so math fonts load even when the page has an
 * opaque/null origin (sandboxed host) where self-hosted, CORS-fetched fonts are
 * blocked. Run before applyPrefix so the resulting https URL is left untouched.
 */
export function applyKatexCdn(html: string, version: string): string {
    return html.replace(
        /href="[^"]*\/katex\.min\.css"/g,
        `href="https://cdn.jsdelivr.net/npm/katex@${version}/dist/katex.min.css"`
    );
}

export function applyPrefix(html: string, prefix: string): string {
    const normalized = '/' + prefix.replace(/^\/+|\/+$/g, '');
    if (normalized === '/') return html; // empty prefix -> no-op
    return html.replace(
        /\b(href|src)="\/(?!\/)([^"]*)"/g,
        (_full, attr: string, rest: string) => `${attr}="${normalized}/${rest}"`
    );
}

/**
 * Removes every <a> whose href is a root-relative internal page link
 * (e.g. "/notes/second/"), leaving its inner content in place. Used only on
 * standalone share pages so they cannot link back into the wiki. Keeps
 * anchors (#…), external (http/https), protocol-relative (//…), and
 * mailto:/tel: links. Anchors never nest, so the non-greedy inner match is safe.
 */
export function stripInternalLinks(html: string): string {
    // href="/x" but NOT href="//x" (protocol-relative).
    return html.replace(
        /<a\b[^>]*\bhref="\/(?!\/)[^"]*"[^>]*>([\s\S]*?)<\/a>/g,
        (_full, inner: string) => inner
    );
}

/**
 * Rewrites a shared page's own image URLs from the absolute form produced by
 * rewriteStaticHtml ("/{dir}/{base}.md.assets/…") to the page-relative form
 * ("{base}.md.assets/…"), so the emitted <share-root>/<slug>/ directory is
 * self-contained and reveals no wiki path. contentPath is the page's source
 * path, e.g. "notes/first.md".
 */
export function rewriteShareAssets(html: string, contentPath: string): string {
    const base = path.posix.basename(contentPath, '.md');
    const dir = path.posix.dirname(contentPath); // "." for root-level files
    const absPrefix = dir === '.' ? `/${base}.md.assets/` : `/${dir}/${base}.md.assets/`;
    const relPrefix = `${base}.md.assets/`;
    // Anchor to an attribute-value boundary (double-quote) so only URL values
    // are touched. rehype-stringify always emits double-quoted attributes.
    return html.split(`"${absPrefix}`).join(`"${relPrefix}`);
}

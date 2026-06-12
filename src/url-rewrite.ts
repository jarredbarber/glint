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
 * Swaps the self-hosted KaTeX stylesheet link for the jsDelivr CDN copy at the
 * given version. The CDN serves the CSS and its fonts with
 * `Access-Control-Allow-Origin: *`, so math fonts load even when the page has an
 * opaque/null origin (sandboxed host) where self-hosted, CORS-fetched fonts are
 * blocked.
 */
export function applyKatexCdn(html: string, version: string): string {
    return html.replace(
        /href="[^"]*\/katex\.min\.css"/g,
        `href="https://cdn.jsdelivr.net/npm/katex@${version}/dist/katex.min.css"`
    );
}

/**
 * Strips every <a> that is an inter-page link, leaving its inner content in
 * place. Used only on standalone share pages so they cannot link back into the
 * wiki and leak no wiki paths. Kept intact: external schemes (http/https),
 * protocol-relative (//…), mailto:, tel:, and in-page anchors (#…). Everything
 * else — root-relative ("/x"), relative ("x.md", "../x") — is stripped to its
 * inner text. Anchors never nest, so the non-greedy inner match is safe.
 */
export function stripInternalLinks(html: string): string {
    // Keep only links that point outside the wiki: external schemes,
    // protocol-relative URLs, and in-page anchors. Everything else — root-
    // relative ("/x"), relative ("x.md", "../x") — is an inter-page link and
    // is stripped to its inner text so a share page leaks no wiki paths and
    // has no broken links. Anchors never nest, so the non-greedy match is safe.
    const KEEP = /^(?:https?:|\/\/|mailto:|tel:|#)/i;
    return html.replace(
        /<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g,
        (full, href: string, inner: string) => (KEEP.test(href) ? full : inner)
    );
}

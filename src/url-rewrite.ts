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

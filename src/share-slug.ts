import crypto from 'node:crypto';

// Hardcoded salt: this is obscurity, not security. It only raises the bar above
// "guess the file path", which is enough for a non-sensitive shareable link.
const SHARE_SALT = 'glint-share-v1-7f3a9c';

/**
 * Stable, salted, URL-safe slug for a shared page. Derived from the content
 * PATH (not its bytes) so the share URL does not churn when the page is edited.
 * Salted HMAC so the slug is not computable from the path alone.
 */
export function shareSlug(contentPath: string): string {
    return crypto
        .createHmac('sha256', SHARE_SALT)
        .update(contentPath)
        .digest('hex')
        .slice(0, 12);
}

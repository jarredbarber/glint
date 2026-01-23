/**
 * Shared utility for extracting the file path from the current URL
 * Handles both new (/f/...) and legacy URL schemas
 */

/**
 * Extract the file path from the current URL, handling both /f/ prefixed and legacy paths
 * @returns The file path for use with /api/source/
 */
export function getFilePath(): string {
    let path = window.location.pathname.substring(1) || 'README.md';
    // Strip /f/ prefix if present (new URL schema)
    if (path.startsWith('f/')) {
        path = path.substring(2);
    }
    return path || 'README.md';
}

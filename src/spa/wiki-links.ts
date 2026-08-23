import { FileMeta } from './storage/types.js';

// Resolve a wiki-link target (a filename, with or without .md) against the
// workspace file list by basename, case-insensitively.
export function resolveWikiLink(name: string, files: FileMeta[]): FileMeta | null {
    const want = name.trim().toLowerCase().replace(/\.md$/, '');
    for (const f of files) {
        const base = f.name.toLowerCase().replace(/\.md$/, '');
        if (base === want) return f;
    }
    return null;
}

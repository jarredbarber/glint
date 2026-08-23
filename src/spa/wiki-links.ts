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

export function normalizePageName(input: string): string | null {
    const stem = input.trim().normalize('NFC').replace(/\.md$/i, '');
    if (!stem || stem === '.' || stem === '..' || /[<>:"/\\|?*#\x00-\x1F]/.test(stem)) return null;
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) return null;
    return `${stem}.md`;
}

export function matchesWikiSearch(query: string, title: string, content: string): boolean {
    const needle = query.trim().toLocaleLowerCase();
    return !needle || title.toLocaleLowerCase().includes(needle) || content.toLocaleLowerCase().includes(needle);
}

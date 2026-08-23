// Glint SPA app shell: routing → adapter → auth → list → render + sidebar + editor.
import { StorageAdapter, FileMeta } from './storage/types.js';
import { FakeAdapter } from './storage/fake.js';
import { LocalAdapter, localSupported } from './storage/local.js';
import { resolveWikiLink } from './wiki-links.js';
import { installEditorShortcuts } from './editor/session.js';

declare const GlintRender: { renderMarkdown(src: string, opts?: any): Promise<string> };

export function parseRoute(hash: string): { backend: string; rest: string[] } | null {
    const m = hash.replace(/^#\/?/, '');
    if (!m) return null;
    const parts = m.split('/').filter(Boolean).map(decodeURIComponent);
    if (!parts.length) return null;
    return { backend: parts[0], rest: parts.slice(1) };
}

function pickAdapter(backend: string): StorageAdapter {
    switch (backend) {
        case 'fake': return new FakeAdapter([
            { name: 'Home.md', content: '# Home\n\nSee [[Notes]].\n\n## Intro\n\nWelcome.' },
            { name: 'Notes.md', content: '## Notes\n\nHello from notes.' },
        ]);
        case 'local':
            if (!localSupported()) throw new Error('Local backend needs a Chromium-based browser (File System Access API).');
            return new LocalAdapter();
        // 'drive' | 'github' wired in Tasks 5–6
        default: throw new Error(`unknown backend: ${backend}`);
    }
}

let currentFileId: string | null = null;
let files: FileMeta[] = [];
let adapter: StorageAdapter;

// Extract the target filename from a wiki-link href (`/f/Target.md`).
function wikiTargetFromHref(href: string): string {
    const m = href.match(/\/f\/(.+)$/);
    return m ? decodeURIComponent(m[1]) : '';
}

async function openFile(id: string) {
    currentFileId = id;
    const { content } = await adapter.read(id);
    const knownPaths = files.map((f) => f.name);
    const html = await GlintRender.renderMarkdown(content, { knownPaths });
    (document.querySelector('.content-wrapper') as HTMLElement).innerHTML = html;
    wireWikiLinks();
    location.hash = routeForFile(id);
}

function routeForFile(id: string): string {
    const route = parseRoute(location.hash) ?? { backend: 'fake', rest: [] };
    return `#/${route.backend}/${encodeURIComponent(id)}`;
}

function wireWikiLinks() {
    document.querySelectorAll<HTMLAnchorElement>('a.internal-link').forEach((a) => {
        a.addEventListener('click', (e) => {
            e.preventDefault();
            const target = resolveWikiLink(wikiTargetFromHref(a.getAttribute('href') || ''), files);
            if (target) void openFile(target.id);
        });
    });
}

function renderSidebar() {
    const nav = document.querySelector('.sidebar') as HTMLElement;
    nav.innerHTML = files.map((f) => `<a href="#" data-id="${f.id}">${f.name}</a>`).join('');
    nav.querySelectorAll<HTMLElement>('a[data-id]').forEach((a) =>
        a.addEventListener('click', (e) => { e.preventDefault(); void openFile(a.dataset.id!); }));
}

export async function boot(): Promise<void> {
    const route = parseRoute(location.hash) ?? { backend: 'fake', rest: [] };
    adapter = pickAdapter(route.backend);
    await adapter.auth();
    files = await adapter.list();
    renderSidebar();
    installEditorShortcuts(adapter, () => currentFileId);
    // A file id may be in the route (rest[0]); else open the first file.
    const routed = route.rest[0] && files.find((f) => f.id === route.rest[0]);
    if (routed) await openFile(routed.id);
    else if (files.length) await openFile(files[0].id);
}

window.addEventListener('DOMContentLoaded', () => void boot());
// Refetch-on-focus replaces SSE live-reload.
window.addEventListener('focus', () => { if (currentFileId) void openFile(currentFileId); });

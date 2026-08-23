// Glint SPA app shell: routing → adapter → auth → list → render + sidebar + editor.
import { StorageAdapter, FileMeta } from './storage/types.js';
import { FakeAdapter } from './storage/fake.js';
import { LocalAdapter, localSupported } from './storage/local.js';
import { DriveAdapter } from './storage/drive.js';
import { GitHubAdapter } from './storage/github.js';
import { resolveWikiLink } from './wiki-links.js';

// Public OAuth client IDs, injected via an optional /config.js that sets
// window.GLINT_CONFIG = { driveClientId, githubClientId }. Client IDs are public.
const CFG: { driveClientId?: string; githubClientId?: string } = (window as any).GLINT_CONFIG ?? {};
import { installEditorShortcuts } from './editor/session.js';

declare const GlintRender: { renderMarkdown(src: string, opts?: any): Promise<string> };

export function parseRoute(hash: string): { backend: string; rest: string[] } | null {
    const m = hash.replace(/^#\/?/, '');
    if (!m) return null;
    const parts = m.split('/').filter(Boolean).map(decodeURIComponent);
    if (!parts.length) return null;
    return { backend: parts[0], rest: parts.slice(1) };
}

function pickAdapter(backend: string, rest: string[]): StorageAdapter {
    switch (backend) {
        case 'fake': return new FakeAdapter([
            { name: 'Home.md', content: '# Home\n\nSee [[Notes]].\n\n## Intro\n\nWelcome.' },
            { name: 'Notes.md', content: '## Notes\n\nHello from notes.' },
        ]);
        case 'local':
            if (!localSupported()) throw new Error('Local backend needs a Chromium-based browser (File System Access API).');
            return new LocalAdapter();
        case 'drive':
            // #/drive/<folderId>
            return new DriveAdapter(rest[0], CFG.driveClientId ?? '');
        case 'gh':
        case 'github': {
            // #/gh/owner/repo/path...  (optional @ref on the last segment)
            const [owner, repo, ...pathParts] = rest;
            let ref = 'main';
            let path = pathParts.join('/');
            const at = path.lastIndexOf('@');
            if (at !== -1) { ref = path.slice(at + 1); path = path.slice(0, at); }
            return new GitHubAdapter(owner, repo, path, ref, CFG.githubClientId ?? '');
        }
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
    adapter = pickAdapter(route.backend, route.rest);
    await adapter.auth();
    files = await adapter.list();
    renderSidebar();
    installEditorShortcuts(adapter, () => currentFileId);
    if (files.length) await openFile(files[0].id);
}

window.addEventListener('DOMContentLoaded', () => void boot());
// Refetch-on-focus replaces SSE live-reload.
window.addEventListener('focus', () => { if (currentFileId) void openFile(currentFileId); });

// Glint SPA app shell: routing → adapter → auth → list → render + sidebar + editor.
import { StorageAdapter, FileMeta } from './storage/types.js';
import { FakeAdapter } from './storage/fake.js';
import { LocalAdapter, localSupported } from './storage/local.js';
import { DriveAdapter } from './storage/drive.js';
import { GitHubAdapter } from './storage/github.js';
import { matchesWikiSearch, normalizePageName, resolveWikiLink } from './wiki-links.js';

// Public Drive OAuth client ID, injected via an optional /config.js that sets
// window.GLINT_CONFIG = { driveClientId }. Client IDs are public. (GitHub uses a
// pasted PAT, not an OAuth client — see storage/github.ts.)
const CFG: { driveClientId?: string } = (window as any).GLINT_CONFIG ?? {};
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
            return new GitHubAdapter(owner, repo, path, ref);
        }
        default: throw new Error(`unknown backend: ${backend}`);
    }
}

let currentFileId: string | null = null;
let files: FileMeta[] = [];
let adapter: StorageAdapter;
const contentCache = new Map<string, string>();
let searchGeneration = 0;

// Extract the target filename from a wiki-link href (`/f/Target.md`).
function wikiTargetFromHref(href: string): string {
    const m = href.match(/\/f\/(.+)$/);
    return m ? decodeURIComponent(m[1]) : '';
}

async function openFile(id: string) {
    currentFileId = id;
    const { content } = await adapter.read(id);
    contentCache.set(id, content);
    const knownPaths = files.map((f) => f.name);
    const html = await GlintRender.renderMarkdown(content, { knownPaths });
    (document.querySelector('.content-wrapper') as HTMLElement).innerHTML = html;
    wireWikiLinks();
    renderSidebar();
}

async function createPage(rawName: string): Promise<void> {
    const name = normalizePageName(rawName);
    if (!name) {
        alert('Enter a standalone Markdown page name.');
        return;
    }
    if (resolveWikiLink(name, files)) {
        alert(`A page named “${name}” already exists.`);
        return;
    }
    try {
        const created = await adapter.create(name, '');
        files = [...files, created];
        renderSidebar();
        await openFile(created.id);
    } catch (error) {
        alert(`Could not create “${name}”: ${(error as Error).message}`);
    }
}

async function deleteCurrentPage(): Promise<void> {
    const id = currentFileId;
    const index = files.findIndex((file) => file.id === id);
    const page = files[index];
    if (!id || !page || !confirm(`Delete “${page.name}”? Only this page will be deleted. This cannot be undone.`)) return;
    try {
        await adapter.delete(id);
        files = files.filter((file) => file.id !== id);
        currentFileId = null;
        renderSidebar();
        const next = files[index] ?? files[index - 1];
        if (next) {
            await openFile(next.id);
        } else {
            (document.querySelector('.content-wrapper') as HTMLElement).innerHTML = '';
        }
    } catch (error) {
        alert(`Could not delete “${page.name}”: ${(error as Error).message}`);
    }
}

async function renderSearch(query: string): Promise<void> {
    const generation = ++searchGeneration;
    const results = document.querySelector<HTMLElement>('[data-search-results]');
    if (!results) return;
    const matches: FileMeta[] = [];
    for (const file of files) {
        let content = contentCache.get(file.id);
        if (content === undefined) {
            content = (await adapter.read(file.id)).content;
            if (generation !== searchGeneration) return;
            contentCache.set(file.id, content);
        }
        if (matchesWikiSearch(query, file.name, content)) matches.push(file);
    }
    if (generation !== searchGeneration) return;
    results.innerHTML = matches.map((file) => `<a href="#" data-id="${file.id}">${file.name}</a>`).join('');
    results.querySelectorAll<HTMLElement>('a[data-id]').forEach((link) =>
        link.addEventListener('click', (event) => { event.preventDefault(); void openFile(link.dataset.id!); }));
}

function wireWikiLinks() {
    document.querySelectorAll<HTMLAnchorElement>('a.internal-link').forEach((a) => {
        a.addEventListener('click', (e) => {
            e.preventDefault();
            const rawTarget = wikiTargetFromHref(a.getAttribute('href') || '');
            const targetName = rawTarget.split('#', 1)[0];
            const target = resolveWikiLink(targetName, files);
            if (target) {
                void openFile(target.id);
                return;
            }
            const pageName = normalizePageName(targetName);
            if (pageName && confirm(`“${pageName}” does not exist. Create it?`)) {
                void createPage(pageName);
            }
        });
    });
}

function renderSidebar() {
    const nav = document.querySelector('.sidebar') as HTMLElement;
    const deleteAction = currentFileId ? '<button data-delete-page>Delete page</button>' : '';
    nav.innerHTML = `<input data-search placeholder="Search pages"><div data-search-results></div><button data-new-page>New page</button>${deleteAction}${files.map((f) => `<a href="#" data-id="${f.id}">${f.name}</a>`).join('')}`;
    nav.querySelector('[data-new-page]')?.addEventListener('click', () => {
        const name = prompt('Page name (.md is optional):');
        if (name !== null) void createPage(name);
    });
    nav.querySelector('[data-delete-page]')?.addEventListener('click', () => void deleteCurrentPage());
    nav.querySelector<HTMLInputElement>('[data-search]')?.addEventListener('input', (event) => {
        void renderSearch((event.target as HTMLInputElement).value);
    });
    nav.querySelectorAll<HTMLElement>('a[data-id]').forEach((a) =>
        a.addEventListener('click', (e) => { e.preventDefault(); void openFile(a.dataset.id!); }));
}

function renderLanding(): void {
    const local = localSupported()
        ? `<li><a href="#/local">Local folder</a> <span class="dim">— pick a directory on this machine</span></li>`
        : `<li class="dim">Local folder — needs a Chromium-based browser</li>`;
    (document.querySelector('.content-wrapper') as HTMLElement).innerHTML = `
        <h1>Glint</h1>
        <p>Open a workspace:</p>
        <ul class="glint-landing">
            ${local}
            <li>Google Drive: <input id="lp-drive" placeholder="folder id" size="30"> <button data-go="drive">Open</button></li>
            <li>GitHub: <input id="lp-gh" placeholder="owner/repo/path" size="30"> <button data-go="gh">Open</button></li>
        </ul>
        <p class="dim">Or append a route to the URL: <code>#/local</code>, <code>#/drive/&lt;folderId&gt;</code>, <code>#/gh/owner/repo/path</code>.</p>`;
    const goTo = (hash: string) => { location.hash = hash; location.reload(); };
    document.querySelector('[data-go="drive"]')?.addEventListener('click', () => {
        const id = (document.getElementById('lp-drive') as HTMLInputElement).value.trim();
        if (id) goTo(`#/drive/${encodeURIComponent(id)}`);
    });
    document.querySelector('[data-go="gh"]')?.addEventListener('click', () => {
        const p = (document.getElementById('lp-gh') as HTMLInputElement).value.trim().replace(/^\/+/, '');
        if (p) goTo(`#/gh/${p}`);
    });
}

export async function boot(): Promise<void> {
    const route = parseRoute(location.hash);
    if (!route) { renderLanding(); return; }   // bare URL → backend picker, not the demo
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

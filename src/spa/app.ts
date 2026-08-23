// Glint SPA app shell: routing → adapter → auth → list → render + sidebar + editor.
import { StorageAdapter, FileMeta } from './storage/types.js';
import { FakeAdapter } from './storage/fake.js';
import { LocalAdapter, localSupported } from './storage/local.js';
import { DriveAdapter } from './storage/drive.js';
import { GitHubAdapter } from './storage/github.js';
import { createStandaloneHtml } from './export.js';
import { matchesWikiSearch, normalizePageName, resolveWikiLink } from './wiki-links.js';
import { buildFileTree, TreeNode } from './file-tree.js';
import { escapeHtml } from '../utils/html.js';
import { appendCommentBlock, appendCommentReply, formatCommentEntry } from './comment-authoring.js';

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
            { name: 'Guides/Welcome.md', content: '## Welcome\n\nA nested page.' },
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
const expandedFolders = new Set<string>();

// Extract the target filename from a wiki-link href (`/f/Target.md`).
function wikiTargetFromHref(href: string): string {
    const m = href.match(/\/f\/(.+)$/);
    return m ? decodeURIComponent(m[1]) : '';
}

async function openFile(id: string) {
    currentFileId = id;
    let content = contentCache.get(id);
    if (content === undefined) {
        const read = await adapter.read(id);
        content = read.content;
        contentCache.set(id, content);
    }
    const knownPaths = files.map((f) => f.name);
    const html = await GlintRender.renderMarkdown(content, { knownPaths });
    (document.querySelector('.content-wrapper') as HTMLElement).innerHTML = html;
    wireWikiLinks();
    wireCommentActions();
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

async function exportCurrentPage(): Promise<void> {
    const id = currentFileId;
    const page = files.find((file) => file.id === id);
    if (!id || !page) return;
    let content = contentCache.get(id);
    if (content === undefined) {
        content = (await adapter.read(id)).content;
        contentCache.set(id, content);
    }
    const html = await GlintRender.renderMarkdown(content, { knownPaths: files.map((file) => file.name) });
    const url = URL.createObjectURL(new Blob([createStandaloneHtml(page.name, html)], { type: 'text/html;charset=utf-8' }));
    const download = document.createElement('a');
    download.href = url;
    download.download = page.name.replace(/\.md$/i, '') + '.html';
    download.click();
    URL.revokeObjectURL(url);
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
    results.innerHTML = matches.map((file) => `<a href="#" data-id="${escapeHtml(file.id)}">${escapeHtml(file.name)}</a>`).join('');
    results.querySelectorAll<HTMLElement>('a[data-id]').forEach((link) =>
        link.addEventListener('click', (event) => {
            event.preventDefault();
            closeMobileSidebar();
            void openFile(link.dataset.id!);
        }));
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

async function saveComment(update: (content: string, entry: string) => string): Promise<void> {
    const id = currentFileId;
    if (!id) return;
    const message = prompt('Comment:')?.trim();
    if (!message) return;
    try {
        const { content, version } = await adapter.read(id);
        const entry = formatCommentEntry(adapter.identity().name, message);
        const next = update(content, entry);
        await adapter.write(id, next, version);
        contentCache.set(id, next);
        await openFile(id);
    } catch (error) {
        alert(`Could not save comment: ${(error as Error).message}`);
    }
}

function wireCommentActions(): void {
    document.querySelectorAll<HTMLButtonElement>('.glint-comment .btn-reply').forEach((button) => {
        button.addEventListener('click', () => {
            const sourceLine = Number(button.closest<HTMLElement>('.glint-comment')?.dataset.sourceLine);
            if (sourceLine) void saveComment((content, entry) => appendCommentReply(content, sourceLine, entry));
        });
    });
}

function installCommentShortcut(): void {
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'c' || event.metaKey || event.ctrlKey || event.altKey) return;
        const target = event.target as HTMLElement;
        if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return;
        if (!currentFileId) return;
        event.preventDefault();
        void saveComment(appendCommentBlock);
    });
}

function renderFileTree(nodes: TreeNode[]): string {
    return nodes.map((node) => {
        if (node.kind === 'file') {
            const active = node.file.id === currentFileId ? ' aria-current="page"' : '';
            return `<li><a href="#" data-id="${escapeHtml(node.file.id)}"${active}>${escapeHtml(node.name)}</a></li>`;
        }
        const open = expandedFolders.has(node.path) ? ' open' : '';
        return `<li><details data-folder-path="${escapeHtml(node.path)}"${open}><summary>${escapeHtml(node.name)}</summary><ul>${renderFileTree(node.children)}</ul></details></li>`;
    }).join('');
}

function renderSidebar() {
    document.body.classList.remove('glint-landing');
    const nav = document.querySelector('.sidebar') as HTMLElement;
    const deleteAction = currentFileId ? '<button data-delete-page>Delete page</button>' : '';
    const exportAction = currentFileId ? '<button data-export-page>Export HTML</button>' : '';
    nav.innerHTML = `<div class="spa-sidebar-controls"><input data-search placeholder="Search pages" aria-label="Search pages"><div data-search-results></div><button data-new-page>New page</button>${exportAction}${deleteAction}</div><div class="spa-page-list"><ul>${renderFileTree(buildFileTree(files))}</ul></div>`;
    nav.querySelector('[data-new-page]')?.addEventListener('click', () => {
        const name = prompt('Page name (.md is optional):');
        if (name !== null) void createPage(name);
    });
    nav.querySelector('[data-export-page]')?.addEventListener('click', () => void exportCurrentPage());
    nav.querySelector('[data-delete-page]')?.addEventListener('click', () => void deleteCurrentPage());
    nav.querySelector<HTMLInputElement>('[data-search]')?.addEventListener('input', (event) => {
        void renderSearch((event.target as HTMLInputElement).value);
    });
    nav.querySelectorAll<HTMLDetailsElement>('details[data-folder-path]').forEach((details) =>
        details.addEventListener('toggle', () => {
            const path = details.dataset.folderPath!;
            if (details.open) expandedFolders.add(path);
            else expandedFolders.delete(path);
        }));
    nav.querySelectorAll<HTMLElement>('a[data-id]').forEach((a) =>
        a.addEventListener('click', (e) => {
            e.preventDefault();
            closeMobileSidebar();
            void openFile(a.dataset.id!);
        }));
}

function renderLanding(): void {
    document.body.classList.add('glint-landing');
    const local = localSupported()
        ? `<a class="glint-source-card" href="#/local"><strong>Local folder</strong><span>Open Markdown from this device.</span></a>`
        : `<div class="glint-source-card disabled"><strong>Local folder</strong><span>Needs a Chromium-based browser.</span></div>`;
    (document.querySelector('.content-wrapper') as HTMLElement).innerHTML = `
        <section class="glint-landing-shell">
            <p class="glint-eyebrow">Markdown, kept close</p>
            <h1>Glint</h1>
            <p class="glint-intro">Read and edit a folder of Markdown without moving it into another workspace.</p>
            <div class="glint-source-grid">
                ${local}
                <form class="glint-source-card" data-source-form="drive">
                    <strong>Google Drive</strong><span>Open a shared folder by ID.</span>
                    <label for="lp-drive">Folder ID</label>
                    <input id="lp-drive" placeholder="1a2b..." autocomplete="off">
                    <button>Open Drive folder</button>
                </form>
                <form class="glint-source-card" data-source-form="gh">
                    <strong>GitHub</strong><span>Open a repository folder with a personal token.</span>
                    <label for="lp-gh">Repository path</label>
                    <input id="lp-gh" placeholder="owner/repo/path" autocomplete="off">
                    <button>Open GitHub folder</button>
                </form>
            </div>
            <p class="glint-route-help">Direct routes also work: <code>#/local</code>, <code>#/drive/&lt;folderId&gt;</code>, or <code>#/gh/owner/repo/path</code>.</p>
        </section>`;
    const goTo = (hash: string) => { location.hash = hash; location.reload(); };
    document.querySelector<HTMLFormElement>('[data-source-form="drive"]')?.addEventListener('submit', (event) => {
        event.preventDefault();
        const id = (document.getElementById('lp-drive') as HTMLInputElement).value.trim();
        if (id) goTo(`#/drive/${encodeURIComponent(id)}`);
    });
    document.querySelector<HTMLFormElement>('[data-source-form="gh"]')?.addEventListener('submit', (event) => {
        event.preventDefault();
        const path = (document.getElementById('lp-gh') as HTMLInputElement).value.trim().replace(/^\/+/, '');
        if (path) goTo(`#/gh/${path}`);
    });
}

function closeMobileSidebar(): void {
    document.body.classList.remove('sidebar-open');
    document.querySelector<HTMLButtonElement>('.mobile-toggle')?.setAttribute('aria-expanded', 'false');
}

function wireMobileSidebar(): void {
    const toggle = document.querySelector<HTMLButtonElement>('.mobile-toggle');
    const overlay = document.querySelector<HTMLElement>('.mobile-overlay');
    toggle?.addEventListener('click', () => {
        const open = document.body.classList.toggle('sidebar-open');
        toggle.setAttribute('aria-expanded', String(open));
    });
    overlay?.addEventListener('click', closeMobileSidebar);
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeMobileSidebar();
    });
}

async function refreshFilesOnFocus(): Promise<void> {
    const id = currentFileId;
    if (!id) return;
    const previous = new Map(files.map((file) => [file.id, file]));
    try {
        const refreshed = await adapter.list();
        const refreshedById = new Map(refreshed.map((file) => [file.id, file]));
        for (const file of refreshed) {
            if (previous.get(file.id)?.version !== file.version) contentCache.delete(file.id);
        }
        for (const file of previous.values()) {
            if (!refreshedById.has(file.id)) contentCache.delete(file.id);
        }
        files = refreshed;
        const current = previous.get(id);
        const replacement = refreshedById.get(id);
        if (!replacement) {
            currentFileId = null;
            (document.querySelector('.content-wrapper') as HTMLElement).innerHTML = '';
            renderSidebar();
        } else if (current?.version !== replacement.version) {
            await openFile(id);
        } else {
            renderSidebar();
        }
    } catch {
        // Keep the last successful view when the backend is temporarily unavailable.
    }
}

export async function boot(): Promise<void> {
    const route = parseRoute(location.hash);
    if (!route) { renderLanding(); return; }   // bare URL → backend picker, not the demo
    adapter = pickAdapter(route.backend, route.rest);
    await adapter.auth();
    document.body.dataset.access = 'edit';
    files = await adapter.list();
    renderSidebar();
    installEditorShortcuts(adapter, () => currentFileId);
    installCommentShortcut();
    if (files.length) await openFile(files[0].id);
}

window.addEventListener('DOMContentLoaded', () => {
    wireMobileSidebar();
    void boot();
});
window.addEventListener('focus', () => void refreshFilesOnFocus());

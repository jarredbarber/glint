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
import { addProject, DEFAULT_STATE, LEGACY_GITHUB_TOKEN_KEY, loadState, normalizeProjectRoute, PersistedStateV1, saveState } from './app-state.js';
import { GitHubOAuthConfig, takeGitHubOAuthCallback } from './github-oauth.js';
import { anchorFromElement, resolveDiscussionAnchors } from './discussions.js';

// Public OAuth IDs and the Worker origin are deployment configuration; secrets never
// enter the SPA.
declare global {
    interface Window {
        GLINT_CONFIG?: { driveClientId?: string; githubClientId?: string; githubOAuthWorkerOrigin?: string; githubRedirectUri?: string };
    }
}
const CFG = window.GLINT_CONFIG ?? {};
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
            return new GitHubAdapter(owner, repo, path, ref, githubOAuthConfig(), githubCallbackToken);
        }
        default: throw new Error(`unknown backend: ${backend}`);
    }
}

const THEMES = ['ayu-dark', 'ayu-light', 'catppuccin-latte', 'catppuccin-mocha', 'default', 'dracula', 'everforest-dark', 'github-light', 'gruvbox-dark', 'kanagawa', 'moonlight', 'nord', 'nvim', 'one-dark', 'rose-pine', 'rose-pine-dawn', 'solarized-light', 'tokyo-night'] as const;
let appState: PersistedStateV1 = DEFAULT_STATE;
let statePersistent = true;
let stateNotice = '';
let githubCallbackToken: string | null = null;

function githubOAuthConfig(): GitHubOAuthConfig | undefined {
    if (!CFG.githubClientId || !CFG.githubOAuthWorkerOrigin || !CFG.githubRedirectUri) return undefined;
    return { clientId: CFG.githubClientId, workerOrigin: CFG.githubOAuthWorkerOrigin, redirectUri: CFG.githubRedirectUri };
}
let currentFileId: string | null = null;
let files: FileMeta[] = [];
let discussionTarget: HTMLElement | null = null;
let adapter: StorageAdapter;
let browserStorage: Storage | null = null;
const contentCache = new Map<string, string>();
let searchGeneration = 0;
const expandedFolders = new Set<string>();

function applyTheme(theme: string): void {
    const link = document.querySelector<HTMLLinkElement>('#glint-theme');
    if (link) link.href = `./assets/themes/${theme}.css`;
}

function persistState(): boolean {
    if (!statePersistent || !browserStorage) return false;
    try {
        saveState(browserStorage, appState, THEMES);
        return true;
    } catch {
        statePersistent = false;
        stateNotice = 'Changes will not be saved in this browser.';
        return false;
    }
}

function sourceSummary(route: string): string {
    if (route === '#/local') return 'Local folder';
    if (route.startsWith('#/drive/')) return `Google Drive: ${decodeURIComponent(route.slice(8))}`;
    return `GitHub: ${decodeURIComponent(route.slice(5))}`;
}

function rememberCurrentProject(): void {
    const route = normalizeProjectRoute(location.hash);
    if (!route) return;
    const name = sourceSummary(route);
    appState = addProject(appState, name, route);
    persistState();
}

function projectControls(): string {
    const options = appState.projects.map((project) => `<option value="${escapeHtml(project.route)}"${project.route === appState.settings.activeProjectRoute ? ' selected' : ''}>${escapeHtml(project.name)} — ${escapeHtml(sourceSummary(project.route))}</option>`).join('');
    return `<label>Project <select data-project-switch><option value="">Choose a Project</option>${options}</select></label><button data-open-source>Open source</button><button data-settings>Settings</button>`;
}

function wireProjectControls(root: ParentNode): void {
    root.querySelector<HTMLSelectElement>('[data-project-switch]')?.addEventListener('change', (event) => {
        const route = (event.target as HTMLSelectElement).value;
        if (route) location.hash = route;
    });
    root.querySelector('[data-open-source]')?.addEventListener('click', () => { location.hash = ''; });
    root.querySelector('[data-settings]')?.addEventListener('click', () => { location.hash = '#/settings'; });
}

function renderSettings(): void {
    document.body.classList.add('glint-landing');
    const rows = appState.projects.map((project, index) => `<li><span>${escapeHtml(project.name)} — ${escapeHtml(sourceSummary(project.route))}</span><button data-open-project="${index}">Open</button><button data-remove-project="${index}">Remove</button></li>`).join('');
    (document.querySelector('.content-wrapper') as HTMLElement).innerHTML = `<section class="glint-landing-shell"><h1 tabindex="-1">Settings</h1><p role="status">${escapeHtml(stateNotice)}</p><label>Theme <select data-theme>${THEMES.map((theme) => `<option value="${theme}"${theme === appState.settings.theme ? ' selected' : ''}>${theme}</option>`).join('')}</select></label><label><input type="checkbox" data-vim${appState.settings.vimMode ? ' checked' : ''}> Use Vim key bindings</label><h2>Projects</h2><ul>${rows}</ul><button data-reset-projects>Reset local Projects and settings</button><p><a href="#">Back to Projects</a></p></section>`;
    const wrapper = document.querySelector('.content-wrapper')!;
    wrapper.querySelector<HTMLSelectElement>('[data-theme]')?.addEventListener('change', (event) => {
        const previous = appState.settings.theme;
        appState = { ...appState, settings: { ...appState.settings, theme: (event.target as HTMLSelectElement).value } };
        applyTheme(appState.settings.theme);
        if (!persistState()) { appState = { ...appState, settings: { ...appState.settings, theme: previous } }; applyTheme(previous); renderSettings(); }
    });
    wrapper.querySelector<HTMLInputElement>('[data-vim]')?.addEventListener('change', (event) => {
        const previous = appState.settings.vimMode;
        appState = { ...appState, settings: { ...appState.settings, vimMode: (event.target as HTMLInputElement).checked } };
        if (!persistState()) { appState = { ...appState, settings: { ...appState.settings, vimMode: previous } }; renderSettings(); }
    });
    wrapper.querySelectorAll<HTMLButtonElement>('[data-open-project]').forEach((button) => button.addEventListener('click', () => { location.hash = appState.projects[Number(button.dataset.openProject)]!.route; }));
    wrapper.querySelectorAll<HTMLButtonElement>('[data-remove-project]').forEach((button) => button.addEventListener('click', () => {
        const project = appState.projects[Number(button.dataset.removeProject)]!;
        if (!confirm(`Remove “${project.name}”? This only removes the local bookmark.`)) return;
        appState = { ...appState, projects: appState.projects.filter((entry) => entry !== project), settings: { ...appState.settings, activeProjectRoute: appState.settings.activeProjectRoute === project.route ? null : appState.settings.activeProjectRoute } };
        persistState();
        renderSettings();
    }));
    wrapper.querySelector('[data-reset-projects]')?.addEventListener('click', () => {
        if (!confirm('Reset local Projects and settings? Backend files will not be changed.')) return;
        appState = { version: 1, projects: [], settings: { ...DEFAULT_STATE.settings } };
        browserStorage?.removeItem(LEGACY_GITHUB_TOKEN_KEY);
        persistState();
        renderSettings();
    });
    (wrapper.querySelector('h1') as HTMLElement).focus();
}

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
    const wrapper = document.querySelector('.content-wrapper') as HTMLElement;
    wrapper.innerHTML = html;
    wireWikiLinks();
    await renderDiscussions(content);
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

async function createDiscussion(): Promise<void> {
    const id = currentFileId;
    const capability = adapter.discussions;
    const content = id ? contentCache.get(id) : undefined;
    const target = discussionTarget ?? document.querySelector<HTMLElement>('.content-wrapper [data-source-line]');
    if (!id || !capability || !content || !target) return;
    const anchor = anchorFromElement(target, content);
    if (!anchor) { alert('Move focus to a rendered source element before adding a discussion.'); return; }
    const message = prompt('New discussion (Markdown):')?.trim();
    if (!message) return;
    try {
        await capability.create(id, anchor, message);
        await renderDiscussions(content);
    } catch (error) {
        alert(`Could not create discussion: ${(error as Error).message}`);
    }
}

async function renderDiscussions(content: string): Promise<void> {
    const id = currentFileId;
    const capability = adapter.discussions;
    const wrapper = document.querySelector('.content-wrapper') as HTMLElement;
    wrapper.querySelectorAll('.glint-discussion, .glint-discussion-controls, .glint-unanchored-discussions').forEach((element) => element.remove());
    if (!id || !capability) return;
    let discussions;
    try { discussions = resolveDiscussionAnchors(content, await capability.list(id)); } catch (error) {
        const errorNode = document.createElement('p');
        errorNode.role = 'alert';
        errorNode.textContent = `Could not load discussions: ${(error as Error).message}`;
        wrapper.append(errorNode);
        return;
    }
    const controls = document.createElement('section');
    controls.className = 'glint-discussion-controls';
    const controlsHeading = document.createElement('h2');
    controlsHeading.textContent = 'Discussions';
    const addDiscussion = document.createElement('button');
    addDiscussion.textContent = 'New comment';
    addDiscussion.addEventListener('click', () => void createDiscussion());
    controls.append(controlsHeading, addDiscussion);
    wrapper.append(controls);
    const unanchored = document.createElement('section');
    unanchored.className = 'glint-unanchored-discussions';
    const heading = document.createElement('h2');
    heading.textContent = 'Unanchored discussions';
    unanchored.append(heading);
    for (const resolved of discussions) {
        const article = document.createElement('article');
        article.className = 'glint-discussion';
        const meta = document.createElement('p');
        meta.textContent = `${resolved.discussion.author} · ${resolved.discussion.createdAt}${resolved.discussion.resolved ? ' · Resolved' : ''}`;
        const body = document.createElement('div');
        body.innerHTML = await GlintRender.renderMarkdown(resolved.discussion.content);
        article.append(meta, body);
        for (const reply of resolved.discussion.replies) {
            const replyNode = document.createElement('div');
            replyNode.className = 'glint-discussion-reply';
            replyNode.textContent = `${reply.author} · ${reply.createdAt}`;
            const replyBody = document.createElement('div');
            replyBody.innerHTML = await GlintRender.renderMarkdown(reply.content);
            replyNode.append(replyBody);
            article.append(replyNode);
        }
        const reply = document.createElement('button');
        reply.textContent = 'Reply';
        reply.addEventListener('click', async () => {
            const message = prompt('Reply (Markdown):')?.trim();
            if (!message) return;
            try { await capability.reply(id, resolved.discussion.id, message); await renderDiscussions(content); } catch (error) { alert(`Could not reply: ${(error as Error).message}`); }
        });
        const resolve = document.createElement('button');
        resolve.textContent = resolved.discussion.resolved ? 'Reopen' : 'Resolve';
        resolve.addEventListener('click', async () => {
            try { await capability.setResolved(id, resolved.discussion.id, !resolved.discussion.resolved); await renderDiscussions(content); } catch (error) { alert(`Could not update discussion: ${(error as Error).message}`); }
        });
        article.append(reply, resolve);
        if (resolved.sourceLine === null) {
            unanchored.append(article);
        } else {
            const source = wrapper.querySelector<HTMLElement>(`[data-source-line="${resolved.sourceLine}"]`);
            if (source) source.insertAdjacentElement('afterend', article);
            else unanchored.append(article);
        }
    }
    if (unanchored.childElementCount > 2) wrapper.append(unanchored);
}

function installCommentShortcut(): void {
    document.addEventListener('pointerover', (event) => {
        const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('.content-wrapper [data-source-line]');
        if (target) discussionTarget = target;
    });
    document.addEventListener('focusin', (event) => {
        const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('.content-wrapper [data-source-line]');
        if (target) discussionTarget = target;
    });
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'c' || event.metaKey || event.ctrlKey || event.altKey) return;
        const target = event.target as HTMLElement;
        if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable || !adapter.discussions || !currentFileId) return;
        event.preventDefault();
        void createDiscussion();
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
    nav.innerHTML = `<div class="spa-sidebar-controls">${projectControls()}<input data-search placeholder="Search pages" aria-label="Search pages"><div data-search-results></div><button data-new-page>New page</button>${exportAction}${deleteAction}</div><div class="spa-page-list"><ul>${renderFileTree(buildFileTree(files))}</ul></div>`;
    wireProjectControls(nav);
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
            <h1 tabindex="-1">Projects</h1>
            <p role="status">${escapeHtml(stateNotice)}</p>
            <p class="glint-intro">Projects are bookmarks stored only in this browser.</p>
            ${appState.projects.length ? `<ul>${appState.projects.map((project) => `<li><a href="${escapeHtml(project.route)}">${escapeHtml(project.name)} — ${escapeHtml(sourceSummary(project.route))}</a></li>`).join('')}</ul>` : '<p>No Projects saved yet.</p>'}
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
                    <input id="lp-gh" placeholder="owner/repo/path@ref" autocomplete="off">
                    <button>Open GitHub folder</button>
                </form>
            </div>
            <p><a href="#/settings">Settings</a></p>
            <p class="glint-route-help">Direct routes also work: <code>#/local</code>, <code>#/drive/&lt;folderId&gt;</code>, or <code>#/gh/owner/repo/path@ref</code>.</p>
        </section>`;
    const goTo = (hash: string) => { location.hash = hash; };
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
    let loaded;
    try {
        browserStorage = window.localStorage;
        loaded = loadState(browserStorage, THEMES);
        browserStorage.removeItem(LEGACY_GITHUB_TOKEN_KEY);
    } catch {
        browserStorage = null;
        loaded = { state: DEFAULT_STATE, persistent: false, notice: 'Changes will not be saved in this browser.' };
    }
    appState = loaded.state;
    statePersistent = loaded.persistent;
    stateNotice = loaded.notice ?? '';
    applyTheme(appState.settings.theme);
    const oauth = githubOAuthConfig();
    if (oauth) githubCallbackToken = await takeGitHubOAuthCallback(oauth);
    const route = parseRoute(location.hash);
    if (!route) { renderLanding(); return; }
    if (route.backend === 'settings') { renderSettings(); return; }
    adapter = pickAdapter(route.backend, route.rest);
    try {
        await adapter.auth();
        document.body.dataset.access = 'edit';
        files = await adapter.list();
    } catch (error) {
        document.body.classList.add('glint-landing');
        (document.querySelector('.content-wrapper') as HTMLElement).innerHTML = `<section class="glint-landing-shell"><h1 tabindex="-1">Could not open source</h1><p role="alert">${escapeHtml((error as Error).message)}</p><p><a href="#">Back to Projects</a></p></section>`;
        (document.querySelector('h1') as HTMLElement).focus();
        return;
    }
    rememberCurrentProject();
    renderSidebar();
    installEditorShortcuts(adapter, () => currentFileId, () => appState.settings.vimMode);
    installCommentShortcut();
    if (files.length) await openFile(files[0].id);
}

window.addEventListener('DOMContentLoaded', () => {
    wireMobileSidebar();
    void boot();
});
window.addEventListener('hashchange', () => void boot());
window.addEventListener('focus', () => void refreshFilesOnFocus());

// Glint SPA app shell: routing → adapter → auth → list → render + sidebar + editor.
import { StorageAdapter, FileMeta, AuthExpiredError, ConflictError, isHtmlFile } from './storage/types.js';
import { FakeAdapter } from './storage/fake.js';
import { LocalAdapter, localSupported } from './storage/local.js';
import { reconcileWrite } from './file-mutation.js';
import { DriveAdapter, browseDriveFolder } from './storage/drive.js';
import { GitHubAdapter, GitHubAuthChoice, GitHubPushMode, hasCachedGitHubToken, forgetGitHubToken } from './storage/github.js';
import { withSilentReauth } from './storage/reauth.js';
import { createStandaloneHtml } from './export.js';
import { isManagedSrc, resolveAssetPath } from './assets.js';
import { matchesWikiSearch, normalizePageName, resolveWikiLink } from './wiki-links.js';
import { buildFileTree, TreeNode } from './file-tree.js';
import { escapeHtml } from '../utils/html.js';
import { addProject, CommentLayout, COMMENT_LAYOUTS, DEFAULT_STATE, defaultProjectName, LEGACY_GITHUB_TOKEN_KEY, loadState, normalizeProjectRoute, PersistedStateV1, renameProject, reorderProject, saveState, Theme, THEMES } from './app-state.js';
import { GitHubOAuthConfig, takeGitHubOAuthCallback, takeGitHubOAuthReturn } from './github-oauth.js';
import { parseSingleRoute, buildShareRoute, buildPageRoute, splitPageRoute, parseGhRoute, parseLandingUrl, routeContains } from './single-route.js';
import { anchorFromElement, resolveDiscussionAnchors } from './discussions.js';
import { wireCustomEmbeds } from './custom-embeds.js';

// Public OAuth IDs and the Worker origin are deployment configuration; secrets never
// enter the SPA.
declare global {
    interface Window {
        GLINT_CONFIG?: { driveClientId?: string; drivePickerKey?: string; driveAppId?: string; githubClientId?: string; githubOAuthWorkerOrigin?: string; githubRedirectUri?: string };
    }
}
const CFG = window.GLINT_CONFIG ?? {};
import { installEditorShortcuts } from './editor/session.js';

declare const GlintRender: {
    renderMarkdown(src: string, opts?: any): Promise<string>;
    drawContentBehaviors(root?: ParentNode): Promise<void>;
};

// Inline single-colour icons (stroke = currentColor) for the app chrome. Kept here so
// the sidebar markup below reads as structure, not paths.
const ICON = {
    mark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 3v3M12 18v3M4.2 6.3l2.1 2.1M17.7 15.6l2.1 2.1M3 12h3M18 12h3M4.2 17.7l2.1-2.1M17.7 8.4l2.1-2.1"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>',
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/></svg>',
    caret: '<svg class="glint-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.3 1a7 7 0 0 0-1.7-1l-.3-2.5H10l-.3 2.5a7 7 0 0 0-1.7 1l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 1.7 1l.3 2.5h3.4l.3-2.5a7 7 0 0 0 1.7-1l2.3 1 2-3.4-2-1.5a7 7 0 0 0 .1-1z"/></svg>',
    source: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/></svg>',
    export: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 11l5 5 5-5M5 21h14"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    // Source-type marks.
    drive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M8 3h8l5.5 9.5-4 6.9H6.5l-4-6.9zM8 3 2.5 12.5M16 3l-5.5 9.5M2.5 12.5h15"/></svg>',
    github: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.36 1.09 2.94.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z"/></svg>',
    local: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.07 0l2-2a5 5 0 0 0-7.07-7.07l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.07 0l-2 2a5 5 0 0 0 7.07 7.07l1.5-1.5"/></svg>',
} as const;

type SourceKind = 'local' | 'drive' | 'gh';
function sourceKind(route: string): SourceKind {
    if (route === '#/local') return 'local';
    if (route.startsWith('#/drive/')) return 'drive';
    return 'gh';
}
function sourceLabel(route: string): string {
    return { local: 'Local folder', drive: 'Google Drive', gh: 'GitHub' }[sourceKind(route)];
}
function sourceIcon(route: string): string {
    return { local: ICON.local, drive: ICON.drive, gh: ICON.github }[sourceKind(route)];
}
// A useful secondary line: the repo path for GitHub, nothing for Drive/local. The raw
// Drive folder id is noise, and the icon already carries the type.
function sourceDetail(route: string): string {
    if (sourceKind(route) !== 'gh') return '';
    return decodeURIComponent(route.slice(5)).replace(/@main$/, '');
}
// The backend's own URL, for opening the original source in a new tab (#1). Local
// folders have no addressable URL, so they return '' and stay in-app.
export function parseRoute(hash: string): { backend: string; rest: string[] } | null {
    const m = hash.replace(/^#\/?/, '');
    if (!m) return null;
    const parts = m.split('/').filter(Boolean).map(decodeURIComponent);
    if (!parts.length) return null;
    return { backend: parts[0], rest: parts.slice(1) };
}

// In-memory demo content. Exercises every render feature the pipeline supports so
// `#/demo` doubles as a visual smoke test. Single-quoted so code-fence backticks stay literal.
const DEMO_PAGES = [
    { name: 'Home.md', content: [
        '---', 'author: Jarred', 'date: 2026-01-08', 'tags: [demo, markdown]', 'status: living document', '---', '',
        '# Glint demo', '',
        'A tour of what the renderer does. Start here, then see [[Tasks]], [[Diagrams]], [[Code]], [[Math]], and [[Comments]].', '',
        '## Prose', '',
        'Text with *emphasis*, **strong**, `inline code`, and a [link](https://github.com/jarredbarber/glint).', '',
        '> A blockquote, for good measure.', '',
        '## Table', '',
        '| Feature | Fenced as | Renders |', '| --- | --- | --- |', '| Diagrams | `mermaid` | SVG flowchart |', '| Math | `$$` | KaTeX |', '',
    ].join('\n') },
    { name: 'Tasks.md', content: [
        '# Tasks', '',
        '- Not a task', '- [ ] Open task', '- [/] In progress', '- [x] Done', '- [b] Blocked, waiting on review',
        '- [ ] Task with metadata (created:2025-12-25 due:2026-02-05 @clanker #urgent)', '',
    ].join('\n') },
    { name: 'Diagrams.md', content: [
        '# Diagrams', '',
        'A flow chart:', '',
        '```mermaid', 'graph TD;', '  A[Start] --> B{Works?};', '  B -- Yes --> C[Ship];', '  B -- No --> D[Debug];', '  D --> B;', '```', '',
    ].join('\n') },
    { name: 'Code.md', content: [
        '# Code', '',
        '```python', 'def fib(n):', '    if n <= 1:', '        return n', '    return fib(n - 1) + fib(n - 2)', '```', '',
    ].join('\n') },
    // String.raw so the LaTeX backslashes survive; headings double as a ToC demo.
    { name: 'Math.md', content: String.raw`# Math

Inline math like $e = mc^2$ renders alongside prose. Display blocks stand alone:

$$E^2 = (mc^2)^2 + (pc)^2$$

## The Euler-Lagrange Equation [[#ref:euler]]

**Goal:** To find the function $q(t)$ that extremizes the action functional $S[q] = \int_{t_1}^{t_2} \mathcal{L}(q, \dot{q}, t) dt$.

We consider a variation $\delta q(t)$ such that $\delta q(t_1) = \delta q(t_2) = 0$. The extremum condition is $\delta S = 0$:
$$ \delta S = \int_{t_1}^{t_2} \left( \frac{\partial \mathcal{L}}{\partial q} \delta q + \frac{\partial \mathcal{L}}{\partial \dot{q}} \delta \dot{q} \right) dt = 0 $$

Since $\delta \dot{q} = \frac{d}{dt} \delta q$, we apply integration by parts to the second term:

$$ \int_{t_1}^{t_2} \frac{\partial \mathcal{L}}{\partial \dot{q}} \frac{d}{dt}(\delta q) dt = \left( \frac{\partial \mathcal{L}}{\partial \dot{q}} \delta q \right)_{t_1}^{t_2} - \int_{t_1}^{t_2} \frac{d}{dt} \left( \frac{\partial \mathcal{L}}{\partial \dot{q}} \right) \delta q \, dt $$

The boundary term vanishes because $\delta q(t_1) = \delta q(t_2) = 0$. Substituting this back:

$$ \int_{t_1}^{t_2} \left( \frac{\partial \mathcal{L}}{\partial q} - \frac{d}{dt} \frac{\partial \mathcal{L}}{\partial \dot{q}} \right) \delta q \, dt = 0 $$

By the Fundamental Lemma of the Calculus of Variations, the integrand must vanish:
$$\frac{\partial \mathcal{L}}{\partial q} - \frac{d}{dt} \left( \frac{\partial \mathcal{L}}{\partial \dot{q}} \right) = 0$$

## Einstein Field Equations [[#ref:einstein]]

**Goal:** To derive the EFE from the Einstein-Hilbert action $S = \int \left( \frac{1}{2\kappa} R + \mathcal{L}_M \right) \sqrt{-g} \, d^4x$.

Varying the action with respect to the inverse metric $g^{\mu\nu}$:

$$ \delta S = \int \left[ \frac{1}{2\kappa} \left( \frac{\delta(\sqrt{-g}R)}{\delta g^{\mu\nu}} \right) + \frac{\delta(\sqrt{-g}\mathcal{L}_M)}{\delta g^{\mu\nu}} \right] \delta g^{\mu\nu} d^4x = 0 $$

Using the variation of the Ricci scalar $R = g^{\mu\nu} R_{\mu\nu}$:

$$ \delta(\sqrt{-g}R) = R_{\mu\nu} \delta(g^{\mu\nu}\sqrt{-g}) + \sqrt{-g} g^{\mu\nu} \delta R_{\mu\nu} $$

The second term (Palatini identity) is a total divergence and vanishes. Using Jacobi's formula for the variation of the determinant $\delta \sqrt{-g} = -\frac{1}{2}\sqrt{-g}g_{\mu\nu}\delta g^{\mu\nu}$:

$$ \delta(\sqrt{-g}R) = \sqrt{-g} \left( R_{\mu\nu} - \frac{1}{2} R g_{\mu\nu} \right) \delta g^{\mu\nu} $$

Defining the Energy-Momentum tensor $T_{\mu\nu} = -2 \frac{1}{\sqrt{-g}} \frac{\delta(\sqrt{-g}\mathcal{L}_M)}{\delta g^{\mu\nu}}$:

$$ \frac{1}{2\kappa} \sqrt{-g} \left( R_{\mu\nu} - \frac{1}{2} R g_{\mu\nu} \right) - \frac{1}{2} \sqrt{-g} T_{\mu\nu} = 0 $$

Rearranging with $\kappa = 8\pi G/c^4$ gives:

$$R_{\mu\nu} - \frac{1}{2}R g_{\mu\nu} + \Lambda g_{\mu\nu} = \frac{8\pi G}{c^4} T_{\mu\nu}$$

## References

- [ref:einstein] "The Field Equations of Gravitation" Einstein, A. (1915) <https://en.wikisource.org/wiki/Translation:The_Field_Equations_of_Gravitation>
- [ref:euler] "Methodus Inveniendi Lineas Curvas Maximi Minive Proprietate Gaudentes" Euler, L. (1744)
` },
    { name: 'Comments.md', content: [
        '# Comments', '',
        'The pipeline renders `comment` fences as annotation blocks. Active:', '',
        '```comment', 'jarred@2026-01-11:14:00 This is a test comment.', '', 'clanker@2026-01-11:14:05 Reply to the test.', '```', '',
        'And resolved (collapsed by the reader):', '',
        '```comment', '#resolved', 'jarred@2026-01-11:15:08 Looks good, shipping.', '```', '',
    ].join('\n') },
    { name: 'Widget.html', content: [
        '<!doctype html><meta charset="utf-8">',
        '<style>body{font:16px system-ui;padding:1.5rem;color:#222}h1{color:#2b6cb0}code{background:#eee;padding:.1rem .3rem;border-radius:3px}</style>',
        '<h1>Raw HTML page</h1>',
        '<p>A <code>.html</code> file in the wiki renders verbatim in a sandboxed iframe (#129):',
        'its own markup, CSS, and images. Page scripts do not run.</p>',
    ].join('\n') },
];

function pickAdapter(backend: string, rest: string[]): StorageAdapter {
    switch (backend) {
        case 'demo': return new FakeAdapter(DEMO_PAGES);
        case 'local':
            if (!localSupported()) throw new Error('Local backend needs a Chromium-based browser (File System Access API).');
            return new LocalAdapter();
        case 'drive':
            // #/drive/<folderId>
            return new DriveAdapter(rest[0], CFG.driveClientId ?? '', CFG.drivePickerKey ?? '', CFG.driveAppId ?? '');
        case 'gh':
        case 'github': {
            // Accepts the tree/legacy project forms (parseGhRoute). Empty ref = auto-detect
            // the repo's default branch (#64). Blob routes are handled as single files upstream.
            const t = parseGhRoute(rest);
            return new GitHubAdapter(t.owner, t.repo, t.path, t.ref, githubOAuthConfig(), githubCallbackToken, promptGitHubAuth);
        }
        default: throw new Error(`unknown backend: ${backend}`);
    }
}

// Single-file mode: an adapter plus the one file to open. gh reads the path directly
// (no recursive listing); demo resolves the name through its listing (opaque fake ids).
function pickSingle(rest: string[]): { adapter: StorageAdapter; fileId: string; resolveByPath?: string } {
    const p = parseSingleRoute(rest);
    if (p.backend === 'gh') {
        const adapter = new GitHubAdapter(p.owner!, p.repo!, '', p.ref, githubOAuthConfig(), githubCallbackToken, promptGitHubAuth);
        return { adapter, fileId: p.path };
    }
    if (p.backend === 'drive') {
        // Drive reads any file by id (alt=media), so no folder is needed; path is the file id.
        return { adapter: new DriveAdapter('', CFG.driveClientId ?? ''), fileId: p.path };
    }
    return { adapter: new FakeAdapter(DEMO_PAGES), fileId: '', resolveByPath: p.path };
}

const COLOR_SCHEMES = ['ayu-dark', 'ayu-light', 'catppuccin-latte', 'catppuccin-mocha', 'default', 'dracula', 'everforest-dark', 'github-light', 'glint', 'gruvbox-dark', 'kanagawa', 'moonlight', 'nord', 'nvim', 'one-dark', 'rose-pine', 'rose-pine-dawn', 'solarized-light', 'tokyo-night'] as const;
let appState: PersistedStateV1 = DEFAULT_STATE;
let statePersistent = true;
let stateNotice = '';
let githubCallbackToken: string | null = null;
// The route to return to when Settings is closed (the last non-settings view).
let settingsReturn = '';

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
// Bumped on every boot(). Async continuations capture it and bail if it changed,
// so a hash change mid-load can never render/mutate the wrong project (#65).
let bootGeneration = 0;
let searchGeneration = 0;
const expandedFolders = new Set<string>();
// Which page was open, and in which project, so returning to a project (e.g. after
// Settings) reopens where you were instead of the default page (#69). Scoped by
// project route because file ids are not unique across sources (#65).
let lastProjectRoute: string | null = null;
let lastFileId: string | null = null;

function applyColorScheme(colorScheme: string): void {
    const link = document.querySelector<HTMLLinkElement>('#glint-color-scheme');
    if (link) link.href = `./assets/color-schemes/${colorScheme}.css`;
}

// Theme is the layout/type/ornament axis; color scheme is colour. They are set
// independently, the theme is a root attribute the per-theme CSS keys off.
function applyTheme(theme: Theme): void {
    document.documentElement.dataset.theme = theme;
}

const THEME_LABELS: Record<Theme, { title: string; blurb: string }> = {
    reader: { title: 'Reader', blurb: 'Warm editorial with serif prose and soft, rounded controls.' },
    almanac: { title: 'Almanac', blurb: 'Printed field guide with a ruled index, small caps, and marginalia.' },
};

const COMMENT_LABELS: Record<CommentLayout, { title: string; blurb: string }> = {
    inline: { title: 'Inline', blurb: 'Comments sit beneath the line they annotate.' },
    rail: { title: 'Side rail', blurb: 'Comments collect in a column beside the page.' },
};

// Comment placement (inline vs. right rail) is a root attribute the CSS keys
// off, applied the way applyTheme swaps the theme.
function applyCommentLayout(layout: CommentLayout): void {
    document.documentElement.dataset.comments = layout;
}

function applyParaHighlight(on: boolean): void {
    document.documentElement.dataset.parahighlight = on ? 'on' : 'off';
}

// A single dismissible modal layer. Resolves via the caller's wiring; Escape / backdrop
// click resolve with the fallback value.
function openModal<T>(html: string, wire: (root: HTMLElement, done: (value: T) => void) => void, fallback: T): Promise<T> {
    return new Promise<T>((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'glint-modal-overlay';
        overlay.innerHTML = `<div class="glint-modal" role="dialog" aria-modal="true">${html}</div>`;
        const done = (value: T) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(value); };
        const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') done(fallback); };
        overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) done(fallback); });
        document.addEventListener('keydown', onKey);
        document.body.append(overlay);
        wire(overlay.querySelector('.glint-modal') as HTMLElement, done);
    });
}

// Small in-app text prompt (replaces window.prompt for naming).
function promptText(title: string, initial = ''): Promise<string | null> {
    const html = `<header class="glint-modal-head"><h2>${escapeHtml(title)}</h2></header>
        <form data-text-form>
            <input type="text" data-text value="${escapeHtml(initial)}" autocomplete="off">
            <div class="glint-modal-actions">
                <button type="button" class="glint-modal-cancel" data-cancel>Cancel</button>
                <button type="submit" class="glint-modal-confirm">Save</button>
            </div>
        </form>`;
    return openModal<string | null>(html, (root, done) => {
        root.querySelector('[data-cancel]')?.addEventListener('click', () => done(null));
        root.querySelector<HTMLFormElement>('[data-text-form]')?.addEventListener('submit', (event) => {
            event.preventDefault();
            done(root.querySelector<HTMLInputElement>('[data-text]')!.value);
        });
        const input = root.querySelector<HTMLInputElement>('[data-text]')!;
        input.focus();
        input.select();
    }, null);
}

// In-app replacement for the GitHub prompt()/confirm() flow. The PAT is returned to the
// adapter, which keeps it in memory only, it is never persisted here.
function promptGitHubAuth(ctx: { owner: string; repo: string; ref: string; hasOAuth: boolean; error?: string }): Promise<GitHubAuthChoice> {
    const oauthBlock = ctx.hasOAuth
        ? `<button type="button" class="glint-modal-primary" data-oauth>Authorize with GitHub</button>
           <div class="glint-modal-or"><span>or paste a token</span></div>`
        : '';
    const html = `
        <header class="glint-modal-head"><h2>Connect GitHub</h2>
            <p>Open <strong>${escapeHtml(ctx.owner)}/${escapeHtml(ctx.repo)}</strong> at <code>${escapeHtml(ctx.ref)}</code></p></header>
        ${oauthBlock}
        <form data-pat-form>
            <label>Fine-grained personal access token
                <input type="password" data-pat autocomplete="off" spellcheck="false" placeholder="github_pat_…">
            </label>
            <p class="glint-modal-help">Saved in this browser so you skip re-entry, never sent to a Glint server. Clear it anytime from Settings. <a href="https://github.com/settings/tokens?type=beta" target="_blank" rel="noopener">How to create one ↗</a></p>
            ${ctx.error ? `<p class="glint-modal-error" role="alert">${escapeHtml(ctx.error)}</p>` : ''}
            <div class="glint-modal-actions">
                <button type="button" class="glint-modal-cancel" data-cancel>Cancel</button>
                <button type="submit" class="glint-modal-confirm">Connect</button>
            </div>
        </form>`;
    return openModal<GitHubAuthChoice>(html, (root, done) => {
        root.querySelector('[data-oauth]')?.addEventListener('click', () => done({ kind: 'oauth' }));
        root.querySelector('[data-cancel]')?.addEventListener('click', () => done(null));
        root.querySelector<HTMLFormElement>('[data-pat-form]')?.addEventListener('submit', (event) => {
            event.preventDefault();
            const token = root.querySelector<HTMLInputElement>('[data-pat]')!.value.trim();
            if (token) done({ kind: 'pat', token });
        });
        root.querySelector<HTMLInputElement>('[data-pat]')?.focus();
    }, null);
}

function persistState(): boolean {
    if (!statePersistent || !browserStorage) return false;
    try {
        saveState(browserStorage, appState, COLOR_SCHEMES);
        return true;
    } catch {
        statePersistent = false;
        stateNotice = 'Changes will not be saved in this browser.';
        return false;
    }
}

function rememberCurrentProject(nameOverride?: string): void {
    // Normalize the project route only, dropping any `/-/<page>` suffix so a pasted page
    // URL doesn't register the page itself as a project (#130).
    const route = normalizeProjectRoute(splitPageRoute(location.hash).projectRoute);
    if (!route) return;
    // Projects are top-level only: if this route sits inside a project we already saved
    // (e.g. a GitHub subtree of a saved repo), don't add it — just make its container the
    // active project (#130).
    const container = appState.projects.find((project) => routeContains(project.route, route));
    if (container) {
        if (appState.settings.activeProjectRoute !== container.route) {
            appState = { ...appState, settings: { ...appState.settings, activeProjectRoute: container.route } };
            persistState();
        }
        return;
    }
    // addProject keeps an existing project's name, so a folder name only lands on
    // first open and never clobbers a manual rename (#69).
    appState = addProject(appState, nameOverride?.trim() || defaultProjectName(route), route);
    persistState();
}

function projectSwitcher(): string {
    const active = appState.projects.find((project) => project.route === appState.settings.activeProjectRoute);
    const icon = active ? sourceIcon(active.route) : ICON.source;
    const options = appState.projects.map((project) => `<option value="${escapeHtml(project.route)}"${project.route === active?.route ? ' selected' : ''}>${escapeHtml(project.name)}</option>`).join('');
    return `<div class="glint-switcher"><span class="glint-source-icon">${icon}</span><select data-project-switch aria-label="Switch project"><option value="">Choose a project</option>${options}</select></div>`;
}

function wireProjectControls(root: ParentNode): void {
    root.querySelector<HTMLSelectElement>('[data-project-switch]')?.addEventListener('change', (event) => {
        const route = (event.target as HTMLSelectElement).value;
        if (route) location.hash = route;
    });
    root.querySelector('[data-open-source]')?.addEventListener('click', () => { location.hash = ''; });
    root.querySelector('[data-settings]')?.addEventListener('click', () => { location.hash = '#/settings'; });
}

function closeSettings(): void {
    // Return to whatever view we came from; fall back to the landing page.
    const target = settingsReturn && settingsReturn !== '#/settings' ? settingsReturn : '';
    if (location.hash === target) void boot();
    else location.hash = target;
}

const GITHUB_PUSH_MODES: { key: GitHubPushMode; label: string }[] = [
    { key: 'direct', label: 'Direct — commit every save immediately' },
    { key: 'staged', label: 'Staged — hold saves, push them in one commit' },
    { key: 'pr', label: 'Pull request — push staged saves as a new branch + PR' },
];

function renderSettings(): void {
    document.body.classList.add('glint-landing');
    const themeCards = THEMES.map((theme) => `<button type="button" class="glint-theme-card${theme === appState.settings.theme ? ' selected' : ''}" data-theme-choice="${theme}"><strong>${escapeHtml(THEME_LABELS[theme].title)}</strong><span>${escapeHtml(THEME_LABELS[theme].blurb)}</span></button>`).join('');
    const colorSchemeOptions = COLOR_SCHEMES.map((cs) => `<option value="${cs}"${cs === appState.settings.colorScheme ? ' selected' : ''}>${cs}</option>`).join('');
    const commentCards = COMMENT_LAYOUTS.map((layout) => `<button type="button" class="glint-theme-card${layout === appState.settings.commentLayout ? ' selected' : ''}" data-comment-choice="${layout}"><strong>${escapeHtml(COMMENT_LABELS[layout].title)}</strong><span>${escapeHtml(COMMENT_LABELS[layout].blurb)}</span></button>`).join('');
    const rows = appState.projects.map((project, index) => {
        const detail = sourceDetail(project.route);
        return `<li class="glint-project-row" draggable="true" data-project-index="${index}"><span class="glint-drag-handle" aria-hidden="true" title="Drag to reorder">⠿</span><span class="glint-source-icon" title="${escapeHtml(sourceLabel(project.route))}">${sourceIcon(project.route)}</span><span class="glint-project-id"><span class="glint-project-name">${escapeHtml(project.name)}</span>${detail ? `<span class="glint-project-source">${escapeHtml(detail)}</span>` : ''}</span><span class="glint-project-actions"><button data-open-project="${index}">Open</button><button data-rename-project="${index}">Rename</button><button class="glint-danger" data-remove-project="${index}">Remove</button></span></li>`;
    }).join('');
    (document.querySelector('.content-wrapper') as HTMLElement).innerHTML = `<section class="glint-landing-shell glint-settings">
        <header class="glint-page-head">
            <div><p class="glint-eyebrow">Preferences</p><h1 tabindex="-1">Settings</h1></div>
            <button class="glint-ghost-btn" data-close-settings aria-label="Close settings">${ICON.close}<span>Close</span></button>
        </header>
        <p role="status">${escapeHtml(stateNotice)}</p>
        <section class="glint-setting-group"><h2>Appearance</h2>
            <p class="glint-setting-note">Theme sets the layout and type; color scheme sets the colours.</p>
            <div class="glint-theme-grid">${themeCards}</div>
            <label class="glint-field">Color scheme <select data-color-scheme>${colorSchemeOptions}</select></label>
        </section>
        <section class="glint-setting-group"><h2>Layout</h2>
            <p class="glint-setting-note">Where comments go.</p>
            <div class="glint-theme-grid">${commentCards}</div>
            <label class="glint-toggle"><input type="checkbox" data-para-highlight${appState.settings.paraHighlight ? ' checked' : ''}> Highlight the paragraph under the cursor</label>
        </section>
        <section class="glint-setting-group"><h2>Editing</h2>
            <label class="glint-toggle"><input type="checkbox" data-vim${appState.settings.vimMode ? ' checked' : ''}> Use Vim key bindings</label>
        </section>
        <section class="glint-setting-group"><h2>GitHub saving</h2>
            <p class="glint-setting-note">How edits reach GitHub. Only affects GitHub projects.</p>
            ${GITHUB_PUSH_MODES.map((m) => `<label class="glint-toggle"><input type="radio" name="gh-push-mode" data-gh-push-mode value="${m.key}"${m.key === appState.settings.githubPushMode ? ' checked' : ''}> ${escapeHtml(m.label)}</label>`).join('')}
        </section>
        ${hasCachedGitHubToken() ? `<section class="glint-setting-group"><h2>Connections</h2>
            <p class="glint-setting-note">Your GitHub token is saved in this browser so you don't re-enter it. It is never sent to a Glint server.</p>
            <button class="glint-danger" data-forget-github>Sign out of GitHub (clear saved token)</button>
        </section>` : ''}
        <section class="glint-setting-group"><h2>Projects</h2>
            ${rows ? `<ul class="glint-project-list">${rows}</ul>` : '<p class="glint-setting-note">No projects saved yet.</p>'}
            <button class="glint-danger" data-reset-projects>Reset local projects and settings</button>
        </section></section>`;
    const wrapper = document.querySelector('.content-wrapper')!;
    wrapper.querySelector('[data-close-settings]')?.addEventListener('click', closeSettings);
    wrapper.querySelectorAll<HTMLButtonElement>('[data-theme-choice]').forEach((button) => button.addEventListener('click', () => {
        const theme = button.dataset.themeChoice as Theme;
        const previous = appState.settings.theme;
        appState = { ...appState, settings: { ...appState.settings, theme } };
        applyTheme(theme);
        if (!persistState()) { appState = { ...appState, settings: { ...appState.settings, theme: previous } }; applyTheme(previous); }
        renderSettings();
    }));
    wrapper.querySelector<HTMLSelectElement>('[data-color-scheme]')?.addEventListener('change', (event) => {
        const previous = appState.settings.colorScheme;
        appState = { ...appState, settings: { ...appState.settings, colorScheme: (event.target as HTMLSelectElement).value } };
        applyColorScheme(appState.settings.colorScheme);
        if (!persistState()) { appState = { ...appState, settings: { ...appState.settings, colorScheme: previous } }; applyColorScheme(previous); renderSettings(); }
    });
    wrapper.querySelectorAll<HTMLButtonElement>('[data-comment-choice]').forEach((button) => button.addEventListener('click', () => {
        const layout = button.dataset.commentChoice as CommentLayout;
        const previous = appState.settings.commentLayout;
        appState = { ...appState, settings: { ...appState.settings, commentLayout: layout } };
        applyCommentLayout(layout);
        if (!persistState()) { appState = { ...appState, settings: { ...appState.settings, commentLayout: previous } }; applyCommentLayout(previous); }
        renderSettings();
    }));
    wrapper.querySelector<HTMLInputElement>('[data-para-highlight]')?.addEventListener('change', (event) => {
        const previous = appState.settings.paraHighlight;
        const on = (event.target as HTMLInputElement).checked;
        appState = { ...appState, settings: { ...appState.settings, paraHighlight: on } };
        applyParaHighlight(on);
        if (!persistState()) { appState = { ...appState, settings: { ...appState.settings, paraHighlight: previous } }; applyParaHighlight(previous); renderSettings(); }
    });
    wrapper.querySelector<HTMLInputElement>('[data-vim]')?.addEventListener('change', (event) => {
        const previous = appState.settings.vimMode;
        appState = { ...appState, settings: { ...appState.settings, vimMode: (event.target as HTMLInputElement).checked } };
        if (!persistState()) { appState = { ...appState, settings: { ...appState.settings, vimMode: previous } }; renderSettings(); }
    });
    wrapper.querySelectorAll<HTMLInputElement>('[data-gh-push-mode]').forEach((radio) => radio.addEventListener('change', (event) => {
        const target = event.target as HTMLInputElement;
        if (!target.checked) return;
        const previous = appState.settings.githubPushMode;
        const mode = target.value as GitHubPushMode;
        appState = { ...appState, settings: { ...appState.settings, githubPushMode: mode } };
        if (adapter instanceof GitHubAdapter) adapter.setPushMode(mode);
        if (!persistState()) { appState = { ...appState, settings: { ...appState.settings, githubPushMode: previous } }; if (adapter instanceof GitHubAdapter) adapter.setPushMode(previous); renderSettings(); }
    }));
    wrapper.querySelectorAll<HTMLButtonElement>('[data-open-project]').forEach((button) => button.addEventListener('click', () => { location.hash = appState.projects[Number(button.dataset.openProject)]!.route; }));
    wrapper.querySelectorAll<HTMLButtonElement>('[data-rename-project]').forEach((button) => button.addEventListener('click', async () => {
        const project = appState.projects[Number(button.dataset.renameProject)]!;
        const name = await promptText('Rename project', project.name);
        if (name === null) return;
        appState = renameProject(appState, project.route, name);
        persistState();
        renderSettings();
    }));
    wrapper.querySelectorAll<HTMLButtonElement>('[data-remove-project]').forEach((button) => button.addEventListener('click', () => {
        const project = appState.projects[Number(button.dataset.removeProject)]!;
        if (!confirm(`Remove “${project.name}”? This only removes the local bookmark.`)) return;
        appState = { ...appState, projects: appState.projects.filter((entry) => entry !== project), settings: { ...appState.settings, activeProjectRoute: appState.settings.activeProjectRoute === project.route ? null : appState.settings.activeProjectRoute } };
        persistState();
        renderSettings();
    }));
    wireProjectReorder(wrapper.querySelector('.glint-project-list'));
    wrapper.querySelector('[data-forget-github]')?.addEventListener('click', () => {
        forgetGitHubToken();
        showToast('Signed out of GitHub', 'success');
        renderSettings();
    });
    wrapper.querySelector('[data-reset-projects]')?.addEventListener('click', () => {
        if (!confirm('Reset local Projects and settings? Backend files will not be changed.')) return;
        appState = { version: 1, projects: [], settings: { ...DEFAULT_STATE.settings } };
        applyTheme(appState.settings.theme);
        applyColorScheme(appState.settings.colorScheme);
        applyCommentLayout(appState.settings.commentLayout);
        applyParaHighlight(appState.settings.paraHighlight);
        browserStorage?.removeItem(LEGACY_GITHUB_TOKEN_KEY);
        persistState();
        renderSettings();
    });
    (wrapper.querySelector('h1') as HTMLElement).focus();
}

// Native HTML5 drag-and-drop to reorder saved projects (#96). ponytail: no DnD library —
// dragstart records the source row, drop commits the move via reorderProject + persist.
function wireProjectReorder(list: HTMLElement | null, rerender: () => void = renderSettings): void {
    if (!list) return;
    let dragIndex: number | null = null;
    const rowIndex = (target: EventTarget | null): number | null => {
        const row = (target as HTMLElement | null)?.closest<HTMLElement>('.glint-project-row');
        const i = row ? Number(row.dataset.projectIndex) : NaN;
        return Number.isInteger(i) ? i : null;
    };
    list.addEventListener('dragstart', (event) => {
        dragIndex = rowIndex(event.target);
        if (dragIndex === null) return;
        (event as DragEvent).dataTransfer!.effectAllowed = 'move';
        (event.target as HTMLElement).closest('.glint-project-row')?.classList.add('glint-dragging');
    });
    list.addEventListener('dragover', (event) => { if (dragIndex !== null) event.preventDefault(); });
    list.addEventListener('dragend', () => {
        list.querySelector('.glint-dragging')?.classList.remove('glint-dragging');
        dragIndex = null;
    });
    list.addEventListener('drop', (event) => {
        event.preventDefault();
        const to = rowIndex(event.target);
        if (dragIndex === null || to === null || to === dragIndex) return;
        appState = reorderProject(appState, dragIndex, to);
        persistState();
        rerender();
    });
}

// Extract the target filename from a wiki-link href (`/f/Target.md`).
function wikiTargetFromHref(href: string): string {
    const m = href.match(/\/f\/(.+)$/);
    return m ? decodeURIComponent(m[1]) : '';
}

// Reuses the .glint-toast CSS shipped in layout.css. Returns the node so a caller can
// flip a persistent "Saving…" toast to "Saved".
function showToast(message: string, type: 'info' | 'success' | 'error' = 'info'): void {
    let container = document.querySelector('.glint-toast-container');
    if (!container) { container = document.createElement('div'); container.className = 'glint-toast-container'; document.body.appendChild(container); }
    const toast = document.createElement('div');
    toast.className = `glint-toast ${type}`;
    const icon = document.createElement('span'); icon.className = 'toast-icon';
    icon.textContent = type === 'success' ? '✔' : type === 'error' ? '✕' : 'ℹ';
    const msg = document.createElement('span'); msg.className = 'toast-message'; msg.textContent = message;
    toast.append(icon, msg);
    container.appendChild(toast);
    setTimeout(() => { toast.classList.add('out'); toast.addEventListener('animationend', () => toast.remove()); }, 2500);
}

function showLoading(label = 'Loading…'): void {
    const wrapper = document.querySelector('.content-wrapper') as HTMLElement | null;
    if (wrapper) wrapper.innerHTML = `<div class="glint-loading" role="status"><span class="glint-spinner" aria-hidden="true"></span><span>${escapeHtml(label)}</span></div>`;
}

// Called by the editor after a successful save: refresh the cache and re-render the
// page in place instead of reloading the SPA (#54).
async function onSectionSaved(id: string, content: string, version: string): Promise<void> {
    // write() already returned the next version; reconcile from it instead of
    // issuing a second read solely to recover it (#63).
    reconcileWrite(files, contentCache, { id, content, version });
    await openFile(id);
    updatePushBadge();
    showToast(adapter instanceof GitHubAdapter && adapter.pushMode() !== 'direct' ? 'Saved (staged for push)' : 'Saved', 'success');
}

// Staged/PR push control (#60): a footer button that flushes buffered edits. Hidden in
// direct mode; disabled when nothing is pending.
function pushControlHtml(): string {
    if (!(adapter instanceof GitHubAdapter)) return '';
    const n = adapter.pendingCount();
    // Show whenever edits are buffered, even if the mode was switched back to direct after
    // staging — otherwise those edits would be stranded with no way to flush them (#60).
    if (adapter.pushMode() === 'direct' && n === 0) return '';
    const label = adapter.pushMode() === 'pr' ? 'Open pull request' : 'Push staged edits';
    return `<button class="glint-icon-btn glint-push-btn" data-push title="${label}" aria-label="${label}"${n === 0 ? ' disabled' : ''}>⬆<span class="glint-push-count" data-push-count>${n}</span></button>`;
}

function updatePushBadge(): void {
    const btn = document.querySelector<HTMLButtonElement>('[data-push]');
    if (!btn || !(adapter instanceof GitHubAdapter)) return;
    const n = adapter.pendingCount();
    btn.disabled = n === 0;
    const count = btn.querySelector('[data-push-count]');
    if (count) count.textContent = String(n);
}

async function triggerPush(): Promise<void> {
    if (!(adapter instanceof GitHubAdapter) || adapter.pendingCount() === 0) return;
    const n = adapter.pendingCount();
    const mode = adapter.pushMode();
    const fallback = `Update ${n} page${n === 1 ? '' : 's'} via Glint`;
    const input = await promptText(mode === 'pr' ? 'Pull request title' : 'Commit message', fallback);
    if (input === null) return;
    const message = input.trim() || fallback;
    try {
        const result = await withSilentReauth(adapter, () => (adapter as GitHubAdapter).push(message));
        // Refresh the file list so app-level shas aren't stale post-commit (a later direct
        // save/delete would otherwise send an old sha and spuriously conflict, #60).
        try { files = await withSilentReauth(adapter, () => adapter.list()); } catch { /* keep old list */ }
        renderSidebar();
        if (result.prUrl) { showToast('Pull request opened', 'success'); window.open(result.prUrl, '_blank', 'noopener'); }
        else showToast('Pushed to GitHub', 'success');
    } catch (error) {
        if (error instanceof AuthExpiredError) showToast('Your connection expired. Reconnect and push again.', 'error');
        else showToast(`Push failed: ${(error as Error).message}`, 'error');
    }
}

// "Open on GitHub" link for the page, rendered at the top of the content (#69).
// Only GitHub has a stable public blob URL per page; Drive/local return ''.
function pageSourceLinkHtml(id: string): string {
    if (!(adapter instanceof GitHubAdapter)) return '';
    const page = files.find((f) => f.id === id);
    if (!page) return '';
    const url = adapter.pageUrl(page.path);
    return `<a class="glint-source-link" href="${escapeHtml(url)}" target="_blank" rel="noopener">${ICON.github}<span>Open on GitHub</span></a>`;
}

// Object URLs minted for managed images in the current render. Revoked when the page
// changes/re-renders/unloads; never immediately after assigning src (#30/#70).
let managedObjectUrls: string[] = [];
function revokeManagedImages(): void {
    for (const url of managedObjectUrls) URL.revokeObjectURL(url);
    managedObjectUrls = [];
}
window.addEventListener('beforeunload', revokeManagedImages);
// Staged edits live only in memory (#60): warn before a close/reload would drop them.
window.addEventListener('beforeunload', (e) => {
    if (adapter instanceof GitHubAdapter && adapter.pendingCount() > 0) { e.preventDefault(); e.returnValue = ''; }
});

function markImageError(img: HTMLImageElement, label: string, retry: () => void): void {
    img.classList.add('glint-image-broken');
    if (!img.alt) img.alt = label;
    if (img.nextElementSibling?.classList.contains('glint-image-error')) img.nextElementSibling.remove();
    const note = document.createElement('span');
    note.className = 'glint-image-error';
    note.textContent = `Image unavailable: ${label} `;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Retry';
    button.addEventListener('click', () => { note.remove(); void retry(); });
    note.appendChild(button);
    img.after(note);
}

// Resolve one managed <img> through the adapter into an object URL. External and data:
// images are left untouched by isManagedSrc; a failure shows a per-image error, not a blank page.
async function resolveManagedImage(img: HTMLImageElement, pagePath: string, gen: number): Promise<void> {
    const src = img.getAttribute('data-glint-src') ?? '';
    if (!isManagedSrc(src)) return;
    const path = resolveAssetPath(pagePath, src);
    if (!path) { markImageError(img, src || '(empty)', () => resolveManagedImage(img, pagePath, bootGeneration)); return; }
    try {
        const blob = await adapter.readAsset(path);
        if (gen !== bootGeneration) return;
        const url = URL.createObjectURL(blob);
        managedObjectUrls.push(url);
        img.src = url;
        img.classList.remove('glint-image-broken');
    } catch {
        markImageError(img, path, () => resolveManagedImage(img, pagePath, bootGeneration));
    }
}

async function resolveManagedImages(root: ParentNode, pagePath: string, gen: number): Promise<void> {
    for (const img of root.querySelectorAll<HTMLImageElement>('img[data-glint-src]')) {
        if (gen !== bootGeneration) return;
        await resolveManagedImage(img, pagePath, gen);
    }
}

async function openFile(id: string) {
    const gen = bootGeneration;
    revokeManagedImages();
    currentFileId = id;
    lastFileId = id;
    // Reflect the open page in the URL bar (#69), so reload/copy lands here. Not in
    // single-file/read-only view (shared-view), and via replaceState so no re-boot fires.
    if (!document.body.classList.contains('shared-view')) {
        const page = files.find((f) => f.id === id);
        if (page) {
            const target = buildPageRoute(splitPageRoute(location.hash).projectRoute, page.path);
            if (location.hash !== target) history.replaceState(null, '', target);
        }
    }
    let content = contentCache.get(id);
    if (content === undefined) {
        const read = await withSilentReauth(adapter, () => adapter.read(id));
        // A newer boot or a newer openFile superseded this read: discard it so a
        // slow backend can't replace the page the user actually selected (#65).
        if (gen !== bootGeneration || currentFileId !== id) return;
        content = read.content;
        contentCache.set(id, content);
    }
    const page = files.find((f) => f.id === id);
    // Raw HTML pages (#129): show the file itself inside a sandboxed iframe rather than
    // running it through the Markdown pipeline. No allow-same-origin, so page scripts run
    // in an opaque origin and cannot reach the SPA's DOM, storage, or adapter tokens.
    if (page && isHtmlFile(page.name)) {
        const wrapper = document.querySelector('.content-wrapper') as HTMLElement;
        const frame = document.createElement('iframe');
        frame.className = 'glint-html-page';
        // No allow-same-origin: page markup, CSS, and images render, but the frame is an
        // opaque origin that can't reach the SPA's DOM, storage, or adapter tokens.
        // ponytail: srcdoc frames inherit the SPA's strict script-src, so page <script>s
        // do NOT run — display only. Running page JS safely needs a separate sandbox
        // origin (its own CSP); the static SPA has none, so that's out of scope here.
        frame.sandbox = 'allow-popups allow-forms allow-modals';
        frame.srcdoc = content;
        wrapper.innerHTML = pageSourceLinkHtml(id);
        wrapper.appendChild(frame);
        renderSidebar();
        return;
    }
    const knownPaths = files.map((f) => f.name);
    const html = await GlintRender.renderMarkdown(content, {
        knownPaths,
        defaultMeta: { author: page?.author, updated: page?.modifiedTime },
    });
    if (gen !== bootGeneration || currentFileId !== id) return;
    const wrapper = document.querySelector('.content-wrapper') as HTMLElement;
    wrapper.innerHTML = pageSourceLinkHtml(id) + html;
    wireCustomEmbeds(wrapper);
    void GlintRender.drawContentBehaviors(wrapper);   // mermaid: innerHTML never runs the emitted scripts
    wireWikiLinks();
    wireTaskCheckboxes();
    void resolveManagedImages(wrapper, files.find((f) => f.id === id)?.path ?? id, gen);
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
        const created = await adapter.create(name, `# ${name.replace(/\.md$/i, '')}\n`);
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
            const rail = document.querySelector<HTMLElement>('.glint-comment-rail');
            if (rail) { rail.innerHTML = ''; rail.hidden = true; }
        }
    } catch (error) {
        alert(`Could not delete “${page.name}”: ${(error as Error).message}`);
    }
}

// #58: copy an absolute single-file share URL to the clipboard.
async function copyShareLink(route: string): Promise<void> {
    const url = `${location.origin}${location.pathname}${route}`;
    try {
        await navigator.clipboard.writeText(url);
        showToast('Link copied', 'success');
    } catch {
        void promptText('Shareable link', url);   // clipboard blocked: show it to copy manually
    }
}

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

// Inline every managed image as a data: URL for the standalone export (its CSP permits
// data: but not blob:). Strips all data-glint-src. Aborts with the full failure list
// rather than emitting a knowingly broken file (#30/#70 AC7).
async function inlineAssetsForExport(renderedHtml: string, pagePath: string): Promise<string> {
    const template = document.createElement('template');
    template.innerHTML = renderedHtml;
    for (const frame of template.content.querySelectorAll<HTMLIFrameElement>('iframe.glint-custom-embed')) {
        const omitted = document.createElement('div');
        omitted.className = 'glint-custom-embed-omitted';
        omitted.textContent = 'Custom embed omitted from offline export.';
        frame.replaceWith(omitted);
    }
    const failures: string[] = [];
    for (const img of template.content.querySelectorAll<HTMLImageElement>('img[data-glint-src]')) {
        const src = img.getAttribute('data-glint-src') ?? '';
        img.removeAttribute('data-glint-src');
        if (!isManagedSrc(src)) continue;   // external/data images stay as-is
        const path = resolveAssetPath(pagePath, src);
        if (!path) { failures.push(src || '(empty)'); continue; }
        try {
            img.setAttribute('src', await blobToDataUrl(await adapter.readAsset(path)));
        } catch {
            failures.push(path);
        }
    }
    if (failures.length) throw new Error(`Export aborted: could not resolve ${failures.length} image(s):\n${failures.join('\n')}`);
    return template.innerHTML;
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
    const rendered = await GlintRender.renderMarkdown(content, { knownPaths: files.map((file) => file.name) });
    let html: string;
    try {
        html = await inlineAssetsForExport(rendered, page.path);
    } catch (error) {
        alert((error as Error).message);   // abort rather than download a knowingly broken file
        return;
    }
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

// Task checkboxes: pre-SPA these were click-to-change-state; the behavior lived in
// the retired serve client and was never rebuilt (#48). The widget still renders
// `.glint-task-check` on a `.glint-task` li carrying `data-source-line`, so a click
// opens a state picker and rewrites that line's marker through the active adapter.
const TASK_STATES: { key: string; marker: string; label: string }[] = [
    { key: 'open', marker: ' ', label: '🟦 Open' },
    { key: 'progress', marker: '/', label: '🏃 In progress' },
    { key: 'done', marker: 'x', label: '✅ Done' },
    { key: 'waiting', marker: 'w', label: '⌛ Waiting' },
    { key: 'blocked', marker: 'b', label: '⛔ Blocked' },
    { key: 'cancelled', marker: 'c', label: '🚫 Cancelled' },
];

let taskPicker: HTMLElement | null = null;

function closeTaskPicker(): void {
    taskPicker?.remove();
    taskPicker = null;
    document.removeEventListener('click', closeTaskPicker);
}

function openTaskStatePicker(anchor: HTMLElement, line: number, currentState: string): void {
    closeTaskPicker();
    const menu = document.createElement('div');
    menu.className = 'glint-task-picker';
    for (const state of TASK_STATES) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'glint-task-picker-item' + (state.key === currentState ? ' is-current' : '');
        item.textContent = state.label;
        item.addEventListener('click', () => { closeTaskPicker(); void setTaskState(line, state.marker); });
        menu.appendChild(item);
    }
    document.body.appendChild(menu);
    const rect = anchor.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.left = `${rect.left}px`;
    taskPicker = menu;
    // Defer so this click doesn't immediately trigger the outside-click close.
    setTimeout(() => document.addEventListener('click', closeTaskPicker), 0);
}

async function setTaskState(line: number, marker: string): Promise<void> {
    const id = currentFileId;
    if (!id) return;
    try {
        const { content, version } = await withSilentReauth(adapter, () => adapter.read(id));
        const lines = content.split('\n');
        const idx = line - 1;
        if (idx < 0 || idx >= lines.length) { alert('Could not locate the task line to update.'); return; }
        const updated = lines[idx].replace(/^(\s*[-*+]\s+)\[[ xX/wbc]\]/, `$1[${marker}]`);
        if (updated === lines[idx]) { alert('Could not find a task marker on that line.'); return; }
        lines[idx] = updated;
        const newContent = lines.join('\n');
        const { version: nextVersion } = await withSilentReauth(adapter, () => adapter.write(id, newContent, version));
        // Record the returned version in FileMeta so the next mutation isn't a
        // stale-version conflict (#63).
        reconcileWrite(files, contentCache, { id, content: newContent, version: nextVersion });
        await openFile(id);
    } catch (error) {
        if (error instanceof ConflictError) alert('This page changed elsewhere. Reopen it and try again.');
        else if (error instanceof AuthExpiredError) alert('Your connection expired. Reconnect and try again.');
        else alert(`Could not update task: ${(error as Error).message}`);
    }
}

function wireTaskCheckboxes(): void {
    document.querySelectorAll<HTMLElement>('.glint-task-check').forEach((check) => {
        check.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const task = check.closest<HTMLElement>('.glint-task');
            const line = Number(task?.getAttribute('data-source-line'));
            if (!task || !line) return;
            openTaskStatePicker(check, line, task.getAttribute('data-state') || 'open');
        });
    });
}

// Inline compose control (textarea + submit) replacing prompt() for comments and replies.
// Cmd/Ctrl+Enter submits; Cancel removes it.
function composeForm(placeholder: string, submitLabel: string, onSubmit: (text: string) => Promise<void>): HTMLFormElement {
    const form = document.createElement('form');
    form.className = 'glint-compose';
    const textarea = document.createElement('textarea');
    textarea.rows = 2;
    textarea.placeholder = placeholder;
    const actions = document.createElement('div');
    actions.className = 'glint-compose-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'glint-compose-cancel';
    cancel.textContent = 'Cancel';
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.textContent = submitLabel;
    actions.append(cancel, submit);
    form.append(textarea, actions);
    cancel.addEventListener('click', () => form.remove());
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const text = textarea.value.trim();
        if (!text) return;
        submit.disabled = true;
        try { await onSubmit(text); form.remove(); } catch (error) { submit.disabled = false; alert((error as Error).message); }
    });
    textarea.addEventListener('keydown', (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); form.requestSubmit(); }
    });
    return form;
}

async function createDiscussion(): Promise<void> {
    const id = currentFileId;
    const capability = adapter.discussions;
    const content = id ? contentCache.get(id) : undefined;
    const target = discussionTarget ?? document.querySelector<HTMLElement>('.content-wrapper [data-source-line]');
    if (!id || !capability || !content || !target) return;
    const anchor = anchorFromElement(target, content);
    if (!anchor) { alert('Move focus to a rendered source element before adding a discussion.'); return; }
    const makeForm = () => composeForm('Add a comment…', 'Comment', async (text) => {
        await capability.create(id, anchor, text);
        await renderDiscussions(content);
    });
    if (appState.settings.commentLayout === 'rail') {
        const rail = document.querySelector<HTMLElement>('.glint-comment-rail');
        if (!rail) return;
        if (rail.querySelector('.glint-compose')) { rail.querySelector<HTMLTextAreaElement>('.glint-compose textarea')?.focus(); return; }
        const form = makeForm();
        const controls = rail.querySelector('.glint-discussion-controls');
        if (controls) controls.insertAdjacentElement('afterend', form); else rail.prepend(form);
        form.querySelector('textarea')?.focus();
        return;
    }
    // Only one new-comment compose open at a time. The anchor tracks the mouse,
    // so guard globally, not just at this target (replies live inside articles).
    const open = [...document.querySelectorAll('.content-wrapper .glint-compose')].find((form) => !form.closest('.glint-discussion'));
    if (open instanceof HTMLElement) { open.querySelector('textarea')?.focus(); return; }
    const form = makeForm();
    target.insertAdjacentElement('afterend', form);
    form.querySelector('textarea')?.focus();
}

// ponytail: collapse state is a single global flag in localStorage, not per-file.
const RAIL_COLLAPSED_KEY = 'glint:comments-collapsed';
function makeRailToggle(rail: HTMLElement): HTMLButtonElement {
    const toggle = document.createElement('button');
    toggle.className = 'glint-rail-toggle';
    const sync = () => {
        const collapsed = rail.classList.contains('collapsed');
        toggle.setAttribute('aria-expanded', String(!collapsed));
        toggle.setAttribute('aria-label', collapsed ? 'Expand comments' : 'Collapse comments');
        toggle.textContent = collapsed ? 'Comments ›' : '‹';
    };
    if (localStorage.getItem(RAIL_COLLAPSED_KEY) === '1') rail.classList.add('collapsed');
    sync();
    toggle.addEventListener('click', () => {
        const collapsed = rail.classList.toggle('collapsed');
        try { localStorage.setItem(RAIL_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch { /* private mode */ }
        sync();
    });
    return toggle;
}

async function renderDiscussions(content: string): Promise<void> {
    const id = currentFileId;
    const capability = adapter.discussions;
    const wrapper = document.querySelector('.content-wrapper') as HTMLElement;
    const rail = document.querySelector<HTMLElement>('.glint-comment-rail');
    const useRail = appState.settings.commentLayout === 'rail' && !!capability;
    wrapper.querySelectorAll('.glint-discussion, .glint-discussion-controls, .glint-unanchored-discussions').forEach((element) => element.remove());
    if (rail) { rail.innerHTML = ''; rail.hidden = true; }
    if (!id || !capability) return;
    let discussions;
    try { discussions = resolveDiscussionAnchors(content, await capability.list(id)); } catch (error) {
        const errorNode = document.createElement('p');
        errorNode.role = 'alert';
        errorNode.textContent = `Could not load discussions: ${(error as Error).message}`;
        (useRail && rail ? rail : wrapper).append(errorNode);
        if (useRail && rail) rail.hidden = false;
        return;
    }
    const controls = document.createElement('section');
    controls.className = 'glint-discussion-controls';
    const controlsHeading = document.createElement('h2');
    controlsHeading.textContent = 'Comments';
    const addDiscussion = document.createElement('button');
    addDiscussion.textContent = 'New comment';
    addDiscussion.addEventListener('click', () => void createDiscussion());
    controls.append(controlsHeading, addDiscussion);
    // Resolved threads render hidden; offer a toggle only when some exist (#55).
    const resolvedCount = discussions.filter((d) => d.discussion.resolved).length;
    if (resolvedCount) {
        const toggle = document.createElement('button');
        toggle.className = 'glint-toggle-resolved';
        const root = document.documentElement;
        const sync = () => { toggle.textContent = root.classList.contains('glint-show-resolved') ? `Hide resolved (${resolvedCount})` : `Show resolved (${resolvedCount})`; };
        sync();
        toggle.addEventListener('click', () => { root.classList.toggle('glint-show-resolved'); sync(); });
        controls.append(toggle);
    }
    if (useRail && rail) {
        rail.hidden = false;
        rail.append(makeRailToggle(rail), controls);
    } else wrapper.append(controls);
    const unanchored = document.createElement('section');
    unanchored.className = 'glint-unanchored-discussions';
    const heading = document.createElement('h2');
    heading.textContent = 'Unanchored discussions';
    unanchored.append(heading);
    for (const resolved of discussions) {
        const article = document.createElement('article');
        article.className = resolved.discussion.resolved ? 'glint-discussion resolved' : 'glint-discussion';
        const meta = document.createElement('p');
        meta.className = 'glint-discussion-meta';
        meta.textContent = `${resolved.discussion.author} · ${resolved.discussion.createdAt}${resolved.discussion.resolved ? ' · Resolved' : ''}`;
        const body = document.createElement('div');
        body.className = 'glint-discussion-body';
        body.innerHTML = await GlintRender.renderMarkdown(resolved.discussion.content);
        wireCustomEmbeds(body);
        article.append(meta, body);
        for (const reply of resolved.discussion.replies) {
            const replyNode = document.createElement('div');
            replyNode.className = 'glint-discussion-reply';
            const replyMeta = document.createElement('p');
            replyMeta.className = 'glint-discussion-meta';
            replyMeta.textContent = `${reply.author} · ${reply.createdAt}`;
            const replyBody = document.createElement('div');
            replyBody.className = 'glint-discussion-body';
            replyBody.innerHTML = await GlintRender.renderMarkdown(reply.content);
            wireCustomEmbeds(replyBody);
            replyNode.append(replyMeta, replyBody);
            article.append(replyNode);
        }
        const reply = document.createElement('button');
        reply.textContent = 'Reply';
        reply.addEventListener('click', () => {
            if (article.querySelector('.glint-compose')) { article.querySelector<HTMLTextAreaElement>('.glint-compose textarea')?.focus(); return; }
            const form = composeForm('Reply…', 'Reply', async (text) => {
                await capability.reply(id, resolved.discussion.id, text);
                await renderDiscussions(content);
            });
            article.append(form);
            form.querySelector('textarea')?.focus();
        });
        const resolve = document.createElement('button');
        resolve.textContent = resolved.discussion.resolved ? 'Reopen' : 'Resolve';
        resolve.addEventListener('click', async () => {
            try { await capability.setResolved(id, resolved.discussion.id, !resolved.discussion.resolved); await renderDiscussions(content); } catch (error) { alert(`Could not update discussion: ${(error as Error).message}`); }
        });
        const actions = document.createElement('div');
        actions.className = 'glint-discussion-actions';
        actions.append(reply, resolve);
        article.append(actions);
        if (useRail && rail) {
            // The rail is not positioned against the text, so label each thread's anchor.
            const anchorHint = document.createElement('p');
            anchorHint.className = 'glint-discussion-anchor';
            anchorHint.textContent = resolved.sourceLine === null ? 'Unanchored' : `Line ${resolved.sourceLine}`;
            article.prepend(anchorHint);
            rail.append(article);
        } else if (resolved.sourceLine === null) {
            unanchored.append(article);
        } else {
            const source = wrapper.querySelector<HTMLElement>(`[data-source-line="${resolved.sourceLine}"]`);
            if (source) source.insertAdjacentElement('afterend', article);
            else unanchored.append(article);
        }
    }
    if (!useRail && unanchored.childElementCount > 2) wrapper.append(unanchored);
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

// "On this page" dock: built from the rendered document (headings already carry
// rehype-slug ids), styled per theme, IntersectionObserver-tracked (#56).
const TOC_COLLAPSED_KEY = 'glint.toc.collapsed';
let tocObserver: IntersectionObserver | null = null;

function tocDockHtml(): string {
    if (!currentFileId) return '';
    const headings = Array.from(document.querySelectorAll<HTMLElement>('.content-wrapper h2[id], .content-wrapper h3[id]'));
    if (headings.length < 2) return '';   // nothing worth an outline
    let open = true;
    try { open = localStorage.getItem(TOC_COLLAPSED_KEY) !== '1'; } catch { /* default open */ }
    const items = headings.map((h) => {
        const sub = h.tagName === 'H3' ? ' toc-h3' : '';
        const clone = h.cloneNode(true) as HTMLElement;
        clone.querySelector('.heading-anchor')?.remove();   // drop the autolink '#' permalink
        const label = (clone.textContent ?? '').trim();
        return `<li class="glint-toc-item${sub}"><a href="#${escapeHtml(h.id)}" data-toc-target="${escapeHtml(h.id)}"><span class="glint-toc-label">${escapeHtml(label)}</span></a></li>`;
    }).join('');
    return `<details class="glint-toc-dock"${open ? ' open' : ''}><summary>On this page</summary><ol class="glint-toc-list">${items}</ol></details>`;
}

function wireTocDock(nav: HTMLElement): void {
    tocObserver?.disconnect();   // drop the previous page's observer (#56)
    tocObserver = null;
    const dock = nav.querySelector<HTMLDetailsElement>('.glint-toc-dock');
    if (!dock) return;
    dock.addEventListener('toggle', () => {
        try { localStorage.setItem(TOC_COLLAPSED_KEY, dock.open ? '0' : '1'); } catch { /* ignore */ }
    });
    const links = Array.from(dock.querySelectorAll<HTMLAnchorElement>('a[data-toc-target]'));
    const headings = links.map((a) => document.getElementById(a.dataset.tocTarget!)).filter((h): h is HTMLElement => !!h);
    for (const a of links) a.addEventListener('click', (e) => {
        e.preventDefault();   // a raw hash link would trip the SPA router
        document.getElementById(a.dataset.tocTarget!)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    // The observer only fires the recompute; current/done are decided from geometry.
    const markActive = () => {
        const line = window.innerHeight * 0.3;
        let currentIdx = -1;
        links.forEach((a, i) => {
            const h = document.getElementById(a.dataset.tocTarget!);
            if (h && h.getBoundingClientRect().top <= line) currentIdx = i;
        });
        links.forEach((a, i) => {
            a.classList.toggle('current', i === currentIdx);
            a.classList.toggle('done', i < currentIdx);
        });
    };
    tocObserver = new IntersectionObserver(markActive, { rootMargin: '0px' });
    for (const h of headings) tocObserver.observe(h);
    markActive();
}

function renderFileTree(nodes: TreeNode[]): string {
    return nodes.map((node) => {
        if (node.kind === 'file') {
            const active = node.file.id === currentFileId ? ' aria-current="page"' : '';
            // The leader span is the Almanac dotted rule between title and folio; hidden in Reader.
            return `<li><a class="glint-tree-file" href="#" data-id="${escapeHtml(node.file.id)}"${active}>${ICON.file}<span class="glint-tree-label">${escapeHtml(node.name)}</span><span class="glint-leader"></span></a></li>`;
        }
        const open = expandedFolders.has(node.path) ? ' open' : '';
        return `<li><details class="glint-tree-folder" data-folder-path="${escapeHtml(node.path)}"${open}><summary>${ICON.caret}${ICON.folder}<span class="glint-tree-label">${escapeHtml(node.name)}</span></summary><ul>${renderFileTree(node.children)}</ul></details></li>`;
    }).join('');
}

// Draggable sidebar width, persisted per browser (#113). clientX is the width
// because the sidebar hugs the viewport's left edge.
const SIDEBAR_W_KEY = 'glint.sidebar.width';
const SIDEBAR_W_MIN = 180;
const SIDEBAR_W_MAX = 520;
function applySidebarWidth(px: number): void {
    document.documentElement.style.setProperty('--sidebar-w', `${px}px`);
}
function initSidebarWidth(): void {
    const saved = parseInt(localStorage.getItem(SIDEBAR_W_KEY) ?? '', 10);
    if (saved >= SIDEBAR_W_MIN && saved <= SIDEBAR_W_MAX) applySidebarWidth(saved);
}
function wireSidebarResize(nav: HTMLElement): void {
    const handle = nav.querySelector<HTMLElement>('.sidebar-resize');
    if (!handle) return;
    handle.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        try { handle.setPointerCapture(event.pointerId); } catch { /* capture is best-effort */ }
        nav.classList.add('resizing');
        document.body.classList.add('sidebar-resizing');
        const clamp = (x: number) => Math.min(SIDEBAR_W_MAX, Math.max(SIDEBAR_W_MIN, Math.round(x)));
        const move = (ev: PointerEvent) => applySidebarWidth(clamp(ev.clientX));
        const up = (ev: PointerEvent) => {
            try { handle.releasePointerCapture(event.pointerId); } catch { /* was never captured */ }
            nav.classList.remove('resizing');
            document.body.classList.remove('sidebar-resizing');
            handle.removeEventListener('pointermove', move);
            handle.removeEventListener('pointerup', up);
            try { localStorage.setItem(SIDEBAR_W_KEY, String(clamp(ev.clientX))); } catch { /* private mode */ }
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
    });
}

function renderSidebar() {
    document.body.classList.remove('glint-landing');
    const nav = document.querySelector('.sidebar') as HTMLElement;
    const canEdit = adapter.capabilities?.().canEdit ?? true;   // #59: hide write affordances when read-only
    const resolvedRef = adapter instanceof GitHubAdapter ? adapter.resolvedRef : undefined;
    const shareRoute = currentFileId ? buildShareRoute(location.hash, files.find((f) => f.id === currentFileId)?.path ?? '', resolvedRef) : null;
    const pageActions = currentFileId
        ? `<button class="glint-icon-btn" data-export-page title="Export HTML" aria-label="Export HTML">${ICON.export}</button>${shareRoute ? `<button class="glint-icon-btn" data-copy-link title="Copy shareable link" aria-label="Copy shareable link">${ICON.link}</button>` : ''}${canEdit ? `<button class="glint-icon-btn" data-delete-page title="Delete page" aria-label="Delete page">${ICON.trash}</button>` : ''}`
        : '';
    nav.innerHTML = `
        <header class="glint-brand">
            <button class="glint-brand-home" data-go-landing title="Home" aria-label="Home"><span class="glint-brand-mark">${ICON.mark}</span><span class="glint-wordmark">Glint</span></button>
        </header>
        <div class="glint-sidebar-top">
            ${projectSwitcher()}
            <div class="glint-search">${ICON.search}<input data-search placeholder="Search pages" aria-label="Search pages"><kbd>⌘K</kbd></div>
            <div class="glint-search-results" data-search-results></div>
        </div>
        <nav class="glint-tree spa-page-list" aria-label="Files"><ul>${renderFileTree(buildFileTree(files))}</ul></nav>
        ${tocDockHtml()}
        <footer class="glint-sidebar-footer">
            ${canEdit ? `<button class="glint-icon-btn" data-new-page title="New page" aria-label="New page">${ICON.plus}</button>` : ''}
            ${pushControlHtml()}
            ${pageActions}
            <button class="glint-icon-btn" data-settings title="Settings" aria-label="Settings">${ICON.gear}</button>
        </footer>
        <div class="sidebar-resize" role="separator" aria-orientation="vertical" aria-label="Resize sidebar" title="Drag to resize"></div>`;
    wireSidebarResize(nav);
    wireProjectControls(nav);
    wireTocDock(nav);
    nav.querySelector('[data-go-landing]')?.addEventListener('click', () => { location.hash = ''; });
    nav.querySelector('[data-new-page]')?.addEventListener('click', () => {
        void promptText('New page name (.md is optional)').then((name) => {
            if (name !== null) void createPage(name);
        });
    });
    nav.querySelector('[data-push]')?.addEventListener('click', () => void triggerPush());
    nav.querySelector('[data-export-page]')?.addEventListener('click', () => void exportCurrentPage());
    nav.querySelector('[data-copy-link]')?.addEventListener('click', () => { if (shareRoute) void copyShareLink(shareRoute); });
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
    const localPicker = localSupported()
        ? `<button type="button" class="glint-url-pick" data-pick-local>${ICON.local}<span>Choose a local folder</span></button>`
        : `<button type="button" class="glint-url-pick" disabled title="Needs a Chromium-based browser">${ICON.local}<span>Local folder (Chromium only)</span></button>`;
    // #92: drive.file grants folder access only through the Google Picker, so the landing
    // page opens it in browse mode; the pasted-link form keeps parsing Drive URLs unchanged.
    const drivePicker = (CFG.driveClientId && CFG.drivePickerKey && CFG.driveAppId)
        ? `<button type="button" class="glint-url-pick" data-pick-drive>${ICON.drive}<span>Google Drive</span></button>`
        : '';
    const projectList = appState.projects.length
        ? `<ul class="glint-project-list">${appState.projects.map((project, index) => {
            const detail = sourceDetail(project.route);
            return `<li class="glint-project-row" draggable="true" data-project-index="${index}"><span class="glint-drag-handle" aria-hidden="true" title="Drag to reorder">⠿</span><a class="glint-project-open" draggable="false" href="${escapeHtml(project.route)}"><span class="glint-source-icon" title="${escapeHtml(sourceLabel(project.route))}">${sourceIcon(project.route)}</span><span class="glint-project-id"><span class="glint-project-name">${escapeHtml(project.name)}</span><span class="glint-project-source">${escapeHtml(detail || sourceLabel(project.route))}</span></span></a></li>`;
        }).join('')}</ul>`
        : '<p class="glint-setting-note">No projects saved yet. Open a source to start one.</p>';
    (document.querySelector('.content-wrapper') as HTMLElement).innerHTML = `
        <section class="glint-landing-shell glint-landing-page">
            <header class="glint-page-head">
                <div><p class="glint-eyebrow">A Markdown wiki</p><h1 tabindex="-1">Glint</h1></div>
                <button class="glint-ghost-btn" data-settings aria-label="Settings">${ICON.gear}<span>Settings</span></button>
            </header>
            <p role="status">${escapeHtml(stateNotice)}</p>
            <div class="glint-landing-cols">
                <section class="glint-landing-col">
                    <h2 class="glint-col-label">Your projects</h2>
                    ${projectList}
                </section>
                <section class="glint-landing-col">
                    <h2 class="glint-col-label">Open a source</h2>
                    <form class="glint-url-open" data-url-form>
                        <label for="lp-url">Paste a link to a repo, folder, or file</label>
                        <input id="lp-url" placeholder="github.com/owner/repo · a Drive/GitHub link · owner/repo/blob/main/file.md" autocomplete="off" spellcheck="false">
                        <p class="glint-url-error" role="alert" data-url-error></p>
                        <div class="glint-url-actions">
                            <button type="submit">Open</button>
                            ${drivePicker}
                            ${localPicker}
                        </div>
                    </form>
                </section>
            </div>
            <p class="glint-setting-note"><a href="./privacy.html">Privacy</a> · <a href="./terms.html">Terms</a></p>
        </section>`;
    (document.querySelector('.content-wrapper') as HTMLElement).querySelector('[data-settings]')?.addEventListener('click', () => { location.hash = '#/settings'; });
    wireProjectReorder(document.querySelector<HTMLElement>('.glint-landing-page .glint-project-list'), renderLanding);
    const form = document.querySelector<HTMLFormElement>('[data-url-form]');
    const errorEl = document.querySelector<HTMLElement>('[data-url-error]');
    form?.addEventListener('submit', (event) => {
        event.preventDefault();
        const value = (document.getElementById('lp-url') as HTMLInputElement).value;
        const route = parseLandingUrl(value);
        if (route) { location.hash = route; return; }
        if (errorEl) errorEl.textContent = value.trim() ? 'Not a recognizable GitHub or Drive link.' : 'Paste a link first.';
    });
    form?.querySelector<HTMLButtonElement>('[data-pick-local]')?.addEventListener('click', () => { location.hash = '#/local'; });
    form?.querySelector<HTMLButtonElement>('[data-pick-drive]')?.addEventListener('click', async (event) => {
        const btn = event.currentTarget as HTMLButtonElement;
        btn.disabled = true;
        try {
            const id = await browseDriveFolder(CFG.driveClientId ?? '', CFG.drivePickerKey ?? '', CFG.driveAppId ?? '');
            if (id) location.hash = `#/drive/${encodeURIComponent(id)}`;
        } catch (error) {
            if (errorEl) errorEl.textContent = (error as Error).message;
        } finally {
            btn.disabled = false;
        }
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
        if (event.key !== 'Escape') return;
        closeMobileSidebar();
        // Escape closes Settings too, unless a modal is capturing it.
        if (location.hash === '#/settings' && !document.querySelector('.glint-modal-overlay')) closeSettings();
    });
}

async function refreshFilesOnFocus(): Promise<void> {
    // Only refresh while viewing a document. On Settings/Landing there is no file
    // view to update, and rebuilding the sidebar there strands it beside the wrong
    // page (#7). currentFileId can still hold the last-opened file, so gate on route.
    const route = parseRoute(location.hash);
    if (!route || route.backend === 'settings') return;
    const id = currentFileId;
    if (!id) return;
    const previous = new Map(files.map((file) => [file.id, file]));
    try {
        const refreshed = await withSilentReauth(adapter, () => adapter.list());
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
            const rail = document.querySelector<HTMLElement>('.glint-comment-rail');
            if (rail) { rail.innerHTML = ''; rail.hidden = true; }
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

function showSourceError(error: Error): void {
    document.body.classList.add('glint-landing');
    const wrapper = document.querySelector('.content-wrapper') as HTMLElement;
    wrapper.innerHTML = `<section class="glint-landing-shell glint-settings">
        <header class="glint-page-head">
            <div><p class="glint-eyebrow">Source</p><h1 tabindex="-1">Could not open source</h1></div>
            <button class="glint-ghost-btn" data-back-landing>${ICON.close}<span>Back to projects</span></button>
        </header>
        <p class="glint-error-msg" role="alert">${escapeHtml(error.message)}</p></section>`;
    wrapper.querySelector('[data-back-landing]')?.addEventListener('click', () => { location.hash = ''; });
    (wrapper.querySelector('h1') as HTMLElement).focus();
}

type SingleTarget = { adapter: StorageAdapter; fileId: string; resolveByPath?: string };

// #/s/<backend>/<address>: render one shared document, no project tree, read-only.
async function bootSingle(rest: string[]): Promise<void> {
    let single;
    try { single = pickSingle(rest); } catch (error) { showSourceError(error as Error); return; }
    await bootSingleResolved(single);
}

async function bootSingleResolved(single: SingleTarget): Promise<void> {
    const myGen = bootGeneration;
    adapter = single.adapter;
    showLoading('Opening page…');
    try {
        await adapter.auth();
        if (myGen !== bootGeneration) return;
        let id = single.fileId;
        if (single.resolveByPath) {
            const found = (await adapter.list()).find((f) => f.path === single.resolveByPath);
            if (myGen !== bootGeneration) return;
            if (!found) throw new Error(`No page named “${single.resolveByPath}”.`);
            id = found.id;
        }
        files = [];
        document.body.classList.add('shared-view');
        document.querySelector('.sidebar')?.classList.add('shared-view');
        await openFile(id);
    } catch (error) {
        showSourceError(error as Error);
    }
}

export async function boot(): Promise<void> {
    const myGen = ++bootGeneration;
    // File ids are not unique across sources, so a previous project's cache must
    // never satisfy a read here (#65). In-project page nav doesn't call boot().
    contentCache.clear();
    // A route change can leave a modal (e.g. a pending GitHub auth prompt) orphaned.
    document.querySelectorAll('.glint-modal-overlay').forEach((overlay) => overlay.remove());
    // Reset per-view chrome so leaving single-file/read-only mode restores the project shell.
    document.body.classList.remove('shared-view');
    document.querySelector('.sidebar')?.classList.remove('shared-view');
    delete document.body.dataset.access;
    // Clear a leftover comment rail from the previous project, or closing one
    // leaves a stray sidebar hanging on the landing/next view (#68).
    const staleRail = document.querySelector<HTMLElement>('.glint-comment-rail');
    if (staleRail) { staleRail.innerHTML = ''; staleRail.hidden = true; }
    discussionTarget = null;
    let loaded;
    try {
        browserStorage = window.localStorage;
        loaded = loadState(browserStorage, COLOR_SCHEMES);
        browserStorage.removeItem(LEGACY_GITHUB_TOKEN_KEY);
    } catch {
        browserStorage = null;
        loaded = { state: DEFAULT_STATE, persistent: false, notice: 'Changes will not be saved in this browser.' };
    }
    appState = loaded.state;
    statePersistent = loaded.persistent;
    stateNotice = loaded.notice ?? '';
    applyColorScheme(appState.settings.colorScheme);
    applyTheme(appState.settings.theme);
    applyCommentLayout(appState.settings.commentLayout);
    applyParaHighlight(appState.settings.paraHighlight);
    const oauth = githubOAuthConfig();
    if (oauth) {
        // Only overwrite on an actual capture, the restore below re-boots without a code,
        // and that second pass must not null the token we just obtained.
        const captured = await takeGitHubOAuthCallback(oauth);
        if (captured) {
            githubCallbackToken = captured;
            const returnTo = takeGitHubOAuthReturn();
            if (returnTo && location.hash !== returnTo) { location.hash = returnTo; return; }
        }
    }
    // A project route may carry the open page as a `/-/<path>` suffix (#69); route on the
    // project part, remember the page to reopen after listing.
    const { projectRoute, pagePath } = splitPageRoute(location.hash);
    const route = parseRoute(projectRoute);
    if (route?.backend !== 'settings') settingsReturn = location.hash;
    if (!route) { renderLanding(); return; }
    if (route.backend === 'settings') { renderSettings(); return; }
    if (route.backend === 's') { await bootSingle(route.rest); return; }
    // A gh `blob` route is a single file (#67): open it read-only, no project tree.
    if (route.backend === 'gh' || route.backend === 'github') {
        let gh;
        try { gh = parseGhRoute(route.rest); } catch (error) { showSourceError(error as Error); return; }
        if (gh.mode === 'blob') {
            const ghAdapter = new GitHubAdapter(gh.owner, gh.repo, '', gh.ref, githubOAuthConfig(), githubCallbackToken, promptGitHubAuth);
            await bootSingleResolved({ adapter: ghAdapter, fileId: gh.path });
            return;
        }
    }
    adapter = pickAdapter(route.backend, route.rest);
    showLoading('Opening project…');
    try {
        await adapter.auth();
        if (myGen !== bootGeneration) return;
        if (adapter instanceof GitHubAdapter) adapter.setPushMode(appState.settings.githubPushMode);
        document.body.dataset.access = 'edit';
        files = await adapter.list();
        if (myGen !== bootGeneration) return;
    } catch (error) {
        if (myGen !== bootGeneration) return;
        showSourceError(error as Error);
        return;
    }
    rememberCurrentProject(adapter instanceof LocalAdapter || adapter instanceof DriveAdapter ? adapter.folderName() : undefined);
    renderSidebar();
    installEditorShortcuts(adapter, () => currentFileId, () => appState.settings.vimMode, onSectionSaved, () => files.find((f) => f.id === currentFileId)?.path ?? null);
    installCommentShortcut();
    // An explicit page in the route wins (#69: reload/copy lands on it). Otherwise returning
    // to the same project reopens the page you left; a different project opens its default page.
    const sameProject = lastProjectRoute === projectRoute;
    lastProjectRoute = projectRoute;
    const reopenId = (pagePath && files.find((f) => f.path === pagePath)?.id)
        || (sameProject && lastFileId && files.some((f) => f.id === lastFileId) ? lastFileId : files[0]?.id);
    if (reopenId) await openFile(reopenId);
}

window.addEventListener('DOMContentLoaded', () => {
    initSidebarWidth();
    wireMobileSidebar();
    void boot();
});
window.addEventListener('hashchange', () => void boot());
window.addEventListener('focus', () => void refreshFilesOnFocus());

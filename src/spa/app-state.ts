export const STATE_KEY = 'glint-spa-state';
export const LEGACY_GITHUB_TOKEN_KEY = 'glint-gh-token';

export const THEMES = ['reader', 'almanac'] as const;
export type Theme = (typeof THEMES)[number];

export const COMMENT_LAYOUTS = ['inline', 'rail'] as const;
export type CommentLayout = (typeof COMMENT_LAYOUTS)[number];

export type ProjectV1 = { name: string; route: string };
export type PersistedStateV1 = {
    version: 1;
    projects: ProjectV1[];
    settings: {
        colorScheme: string;
        theme: Theme;
        commentLayout: CommentLayout;
        contentBar: boolean;
        vimMode: boolean;
        activeProjectRoute: string | null;
    };
};

export const DEFAULT_STATE: PersistedStateV1 = {
    version: 1,
    projects: [],
    settings: { colorScheme: 'nord', theme: 'reader', commentLayout: 'inline', contentBar: false, vimMode: true, activeProjectRoute: null },
};

function copyDefault(): PersistedStateV1 {
    return { version: 1, projects: [], settings: { ...DEFAULT_STATE.settings } };
}

// A short, human default so an un-renamed Drive folder never spills its 44-char id
// into the sidebar. The full source is still shown as a secondary line in the UI.
export function defaultProjectName(route: string): string {
    if (route === '#/local') return 'Local folder';
    if (route.startsWith('#/drive/')) return 'Drive folder';
    const m = route.match(/^#\/gh\/([^/]+)\/([^/]+)/);
    return m ? `${decodeURIComponent(m[1])}/${decodeURIComponent(m[2])}` : 'Project';
}

export function normalizeProjectRoute(route: string): string | null {
    const raw = route.trim().replace(/^#?\/?/, '');
    const parts = raw.split('/');
    if (parts[0] === 'local' && parts.length === 1) return '#/local';
    if (parts[0] === 'drive' && parts.length === 2) {
        const folderId = parts[1]?.trim();
        return folderId ? `#/drive/${encodeURIComponent(decodeURIComponent(folderId))}` : null;
    }
    if (parts[0] !== 'gh' || parts.length < 3) return null;
    const owner = parts[1]?.trim().toLowerCase();
    const repo = parts[2]?.trim().toLowerCase();
    // github.com-style `tree/<ref>/<path>` project routes (#67): fold the ref into the
    // internal `@ref` form below. `blob/...` is a single file, never a project.
    let tailParts = parts.slice(3);
    let treeRef = '';
    if (tailParts[0] === 'blob') return null;
    if (tailParts[0] === 'tree') { treeRef = tailParts[1] ?? ''; tailParts = tailParts.slice(2); }
    const tail = treeRef ? `${tailParts.join('/')}@${treeRef}` : tailParts.join('/');
    const at = tail.lastIndexOf('@');
    // No @ref = auto-detect the repo's default branch (#64); keep it out of the route so
    // it stays distinct from an explicit @main pin.
    const ref = (at < 0 ? '' : tail.slice(at + 1)).trim();
    const path = (at < 0 ? tail : tail.slice(0, at)).split('/').filter((part) => part && part !== '.');
    if (!owner || !repo || (at >= 0 && !ref) || path.includes('..')) return null;
    const sub = path.map(encodeURIComponent).join('/');
    const prefix = `#/gh/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    // @ref stays on the path portion so pickAdapter's lastIndexOf('@') finds it even when
    // the path is empty (`#/gh/o/r/@ref`). No ref = a clean auto-detect route.
    if (ref) return `${prefix}/${sub}@${encodeURIComponent(ref)}`;
    return sub ? `${prefix}/${sub}` : prefix;
}

function validatedState(value: unknown, colorSchemes: readonly string[]): PersistedStateV1 | null {
    if (!value || typeof value !== 'object') return null;
    const source = value as Record<string, unknown>;
    if (source.version !== 1 || !Array.isArray(source.projects) || !source.settings || typeof source.settings !== 'object') return null;
    const projects: ProjectV1[] = [];
    const routes = new Set<string>();
    for (const project of source.projects) {
        if (!project || typeof project !== 'object') return null;
        const p = project as Record<string, unknown>;
        const name = typeof p.name === 'string' ? p.name.trim() : '';
        const route = typeof p.route === 'string' ? normalizeProjectRoute(p.route) : null;
        if (!name || !route || routes.has(route)) return null;
        routes.add(route);
        projects.push({ name, route });
    }
    const settings = source.settings as Record<string, unknown>;
    if (typeof settings.vimMode !== 'boolean' || (settings.activeProjectRoute !== null && typeof settings.activeProjectRoute !== 'string')) return null;
    const activeProjectRoute = settings.activeProjectRoute === null ? null : normalizeProjectRoute(settings.activeProjectRoute as string);
    if (settings.activeProjectRoute !== null && (!activeProjectRoute || !routes.has(activeProjectRoute))) return null;
    const colorScheme = typeof settings.colorScheme === 'string' && colorSchemes.includes(settings.colorScheme) ? settings.colorScheme : 'nord';
    // Theme/layout backfill like color scheme (fallback, never reject) so records written before
    // these axes existed keep loading.
    const theme: Theme = settings.theme === 'almanac' ? 'almanac' : 'reader';
    const commentLayout: CommentLayout = settings.commentLayout === 'rail' ? 'rail' : 'inline';
    const contentBar = settings.contentBar === true;
    return { version: 1, projects, settings: { colorScheme, theme, commentLayout, contentBar, vimMode: settings.vimMode, activeProjectRoute } };
}

export type StateLoad = { state: PersistedStateV1; notice?: string; persistent: boolean };

export function loadState(storage: Storage, colorSchemes: readonly string[]): StateLoad {
    try {
        const raw = storage.getItem(STATE_KEY);
        if (raw === null) return { state: copyDefault(), persistent: true };
        const state = validatedState(JSON.parse(raw), colorSchemes);
        if (state) return { state, persistent: true };
        storage.setItem(STATE_KEY, JSON.stringify(copyDefault()));
        return { state: copyDefault(), persistent: true, notice: 'Local Projects and settings were reset because stored data was not supported.' };
    } catch {
        return { state: copyDefault(), persistent: false, notice: 'Changes will not be saved in this browser.' };
    }
}

export function saveState(storage: Storage, state: PersistedStateV1, colorSchemes: readonly string[]): boolean {
    const valid = validatedState(state, colorSchemes);
    if (!valid) throw new Error('refusing to save invalid Projects state');
    storage.setItem(STATE_KEY, JSON.stringify(valid));
    return true;
}

export function addProject(state: PersistedStateV1, name: string, route: string): PersistedStateV1 {
    const normalized = normalizeProjectRoute(route);
    const label = name.trim();
    if (!normalized || !label) throw new Error('Project name and source route are required.');
    const existing = state.projects.find((project) => project.route === normalized);
    if (existing) return { ...state, settings: { ...state.settings, activeProjectRoute: existing.route } };
    return { ...state, projects: [...state.projects, { name: label, route: normalized }], settings: { ...state.settings, activeProjectRoute: normalized } };
}

export function renameProject(state: PersistedStateV1, route: string, name: string): PersistedStateV1 {
    const label = name.trim();
    if (!label) return state;
    return { ...state, projects: state.projects.map((project) => (project.route === route ? { ...project, name: label } : project)) };
}

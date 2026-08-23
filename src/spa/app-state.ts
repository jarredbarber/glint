export const STATE_KEY = 'glint-spa-state';
export const LEGACY_GITHUB_TOKEN_KEY = 'glint-gh-token';

export type ProjectV1 = { name: string; route: string };
export type PersistedStateV1 = {
    version: 1;
    projects: ProjectV1[];
    settings: { theme: string; vimMode: boolean; activeProjectRoute: string | null };
};

export const DEFAULT_STATE: PersistedStateV1 = {
    version: 1,
    projects: [],
    settings: { theme: 'nord', vimMode: true, activeProjectRoute: null },
};

function copyDefault(): PersistedStateV1 {
    return { version: 1, projects: [], settings: { ...DEFAULT_STATE.settings } };
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
    const tail = parts.slice(3).join('/');
    const at = tail.lastIndexOf('@');
    const ref = (at < 0 ? 'main' : tail.slice(at + 1)).trim();
    const path = (at < 0 ? tail : tail.slice(0, at)).split('/').filter((part) => part && part !== '.');
    if (!owner || !repo || !ref || path.includes('..')) return null;
    return `#/gh/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${path.map(encodeURIComponent).join('/')}@${encodeURIComponent(ref)}`;
}

function validatedState(value: unknown, themes: readonly string[]): PersistedStateV1 | null {
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
    const theme = typeof settings.theme === 'string' && themes.includes(settings.theme) ? settings.theme : 'nord';
    return { version: 1, projects, settings: { theme, vimMode: settings.vimMode, activeProjectRoute } };
}

export type StateLoad = { state: PersistedStateV1; notice?: string; persistent: boolean };

export function loadState(storage: Storage, themes: readonly string[]): StateLoad {
    try {
        const raw = storage.getItem(STATE_KEY);
        if (raw === null) return { state: copyDefault(), persistent: true };
        const state = validatedState(JSON.parse(raw), themes);
        if (state) return { state, persistent: true };
        storage.setItem(STATE_KEY, JSON.stringify(copyDefault()));
        return { state: copyDefault(), persistent: true, notice: 'Local Projects and settings were reset because stored data was not supported.' };
    } catch {
        return { state: copyDefault(), persistent: false, notice: 'Changes will not be saved in this browser.' };
    }
}

export function saveState(storage: Storage, state: PersistedStateV1, themes: readonly string[]): boolean {
    const valid = validatedState(state, themes);
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

import assert from 'node:assert/strict';
import test from 'node:test';
import { addProject, DEFAULT_STATE, loadState, normalizeProjectRoute, saveState } from '../spa/app-state.js';

const colorSchemes = ['nord', 'one-dark'];

class MemoryStorage {
    values = new Map<string, string>();
    getItem(key: string) { return this.values.get(key) ?? null; }
    setItem(key: string, value: string) { this.values.set(key, value); }
    removeItem(key: string) { this.values.delete(key); }
}

test('normalizes and deduplicates direct source routes', () => {
    // No @ref = auto-detect the default branch (#64), kept out of the route.
    assert.equal(normalizeProjectRoute('#/gh/Owner/Repo/a/./b'), '#/gh/owner/repo/a/b');
    assert.equal(normalizeProjectRoute('#/gh/owner/repo'), '#/gh/owner/repo');
    assert.equal(normalizeProjectRoute('#/gh/owner/repo/docs@master'), '#/gh/owner/repo/docs@master');
    assert.equal(normalizeProjectRoute('#/gh/owner/repo/a/../b@main'), null);
    const state = addProject(DEFAULT_STATE, 'Repo', '#/gh/Owner/Repo/docs');
    const duplicate = addProject(state, 'Changed name', '#/gh/owner/repo/docs');
    assert.equal(duplicate.projects.length, 1);
    assert.equal(duplicate.settings.activeProjectRoute, '#/gh/owner/repo/docs');
    // An explicit @main pin is a distinct route from the auto-detect form.
    const pinned = addProject(duplicate, 'Pinned', '#/gh/owner/repo/docs@main');
    assert.equal(pinned.projects.length, 2);
});

test('loads an exact valid V1 record and resets invalid state', () => {
    const storage = new MemoryStorage();
    const state = addProject(DEFAULT_STATE, 'Drive', '#/drive/a folder');
    saveState(storage as unknown as Storage, state, colorSchemes);
    assert.deepEqual(loadState(storage as unknown as Storage, colorSchemes).state, state);
    storage.setItem('glint-spa-state', '{"version":2}');
    const loaded = loadState(storage as unknown as Storage, colorSchemes);
    assert.deepEqual(loaded.state, DEFAULT_STATE);
    assert.match(loaded.notice ?? '', /reset/);
});

test('invalid runtime color scheme falls back to nord', () => {
    const storage = new MemoryStorage();
    storage.setItem('glint-spa-state', JSON.stringify({ version: 1, projects: [], settings: { colorScheme: 'unknown', vimMode: true, activeProjectRoute: null } }));
    assert.equal(loadState(storage as unknown as Storage, colorSchemes).state.settings.colorScheme, 'nord');
});

test('theme backfills to reader for records with no or invalid theme', () => {
    const storage = new MemoryStorage();
    storage.setItem('glint-spa-state', JSON.stringify({ version: 1, projects: [], settings: { colorScheme: 'nord', vimMode: true, activeProjectRoute: null } }));
    assert.equal(loadState(storage as unknown as Storage, colorSchemes).state.settings.theme, 'reader');
    storage.setItem('glint-spa-state', JSON.stringify({ version: 1, projects: [], settings: { colorScheme: 'nord', theme: 'almanac', vimMode: false, activeProjectRoute: null } }));
    assert.equal(loadState(storage as unknown as Storage, colorSchemes).state.settings.theme, 'almanac');
});

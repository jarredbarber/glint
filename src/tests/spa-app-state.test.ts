import assert from 'node:assert/strict';
import test from 'node:test';
import { addProject, DEFAULT_STATE, loadState, normalizeProjectRoute, saveState } from '../spa/app-state.js';

const themes = ['nord', 'one-dark'];

class MemoryStorage {
    values = new Map<string, string>();
    getItem(key: string) { return this.values.get(key) ?? null; }
    setItem(key: string, value: string) { this.values.set(key, value); }
    removeItem(key: string) { this.values.delete(key); }
}

test('normalizes and deduplicates direct source routes', () => {
    assert.equal(normalizeProjectRoute('#/gh/Owner/Repo/a/./b'), '#/gh/owner/repo/a/b@main');
    assert.equal(normalizeProjectRoute('#/gh/owner/repo/a/../b@main'), null);
    const state = addProject(DEFAULT_STATE, 'Repo', '#/gh/Owner/Repo/docs');
    const duplicate = addProject(state, 'Changed name', '#/gh/owner/repo/docs@main');
    assert.equal(duplicate.projects.length, 1);
    assert.equal(duplicate.settings.activeProjectRoute, '#/gh/owner/repo/docs@main');
});

test('loads an exact valid V1 record and resets invalid state', () => {
    const storage = new MemoryStorage();
    const state = addProject(DEFAULT_STATE, 'Drive', '#/drive/a folder');
    saveState(storage as unknown as Storage, state, themes);
    assert.deepEqual(loadState(storage as unknown as Storage, themes).state, state);
    storage.setItem('glint-spa-state', '{"version":2}');
    const loaded = loadState(storage as unknown as Storage, themes);
    assert.deepEqual(loaded.state, DEFAULT_STATE);
    assert.match(loaded.notice ?? '', /reset/);
});

test('invalid runtime theme falls back to nord', () => {
    const storage = new MemoryStorage();
    storage.setItem('glint-spa-state', JSON.stringify({ version: 1, projects: [], settings: { theme: 'unknown', vimMode: true, activeProjectRoute: null } }));
    assert.equal(loadState(storage as unknown as Storage, themes).state.settings.theme, 'nord');
});

test('skin backfills to reader for records with no or invalid skin', () => {
    const storage = new MemoryStorage();
    storage.setItem('glint-spa-state', JSON.stringify({ version: 1, projects: [], settings: { theme: 'nord', vimMode: true, activeProjectRoute: null } }));
    assert.equal(loadState(storage as unknown as Storage, themes).state.settings.skin, 'reader');
    storage.setItem('glint-spa-state', JSON.stringify({ version: 1, projects: [], settings: { theme: 'nord', skin: 'almanac', vimMode: false, activeProjectRoute: null } }));
    assert.equal(loadState(storage as unknown as Storage, themes).state.settings.skin, 'almanac');
});

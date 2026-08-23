# Glint SPA (Drive / GitHub / Local) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Glint as a static, server-less SPA that turns a GitHub repo / Google Drive folder / local directory into a browsable, editable wiki, and retire `glint serve`.

**Architecture:** One static runtime over a single `StorageAdapter` seam with four implementations (Fake, Drive, GitHub, Local). The existing remark→rehype pipeline (`src/pipeline.ts`, already browser-bundled via `src/browser.ts`) renders; a rewritten section-as-unit editor edits; auth is backend-native (no Glint user DB). Deploys to GitHub Pages.

**Tech Stack:** TypeScript (strict, ESM), esbuild bundles, unified/remark/rehype, CodeMirror 6, Google Identity Services + Drive REST, GitHub device-flow OAuth + Contents API, File System Access API. Node's native test runner (`tsx --test`).

**Spec:** `docs/superpowers/specs/2026-08-23-drive-github-spa-design.md` (read it — source of truth). Companion: `docs/editor-review.md` (section-as-unit editor rationale, issue #8).

## Global Constraints

- **No new runtime dependencies** unless a task explicitly adds one. Ponytail mode: stdlib/native/already-installed first. The seam adapters use `fetch`, GIS (`<script>` tag), and browser APIs — no SDK packages.
- **Never `git add` `assets/*.bundle.js`** — gitignored build artifacts. Rebuild with `npm run bundle`. Commit only `src/`, `docs/`, `package.json`, and static SPA host files.
- **Never stage `demo.md`** — it holds the user's scratch edits. `git add` explicit paths only.
- **TypeScript strict mode** — every file compiles under `tsc` with no errors.
- **Commit + push per task** (project CLAUDE.md). Branch `feat/drive-github-spa` already exists.
- All new SPA code lives under `src/spa/`. Existing `src/pipeline.ts` / `src/browser.ts` / `src/client/editor.ts` are reused, not duplicated.
- `version` in the seam is the backend's native concurrency token (Drive `modifiedTime`, GitHub blob `sha`, local `lastModified`). A `write` with a stale `version` is a conflict the adapter rejects.

**Pre-verified (do not redo):** Sequencing step 1 (extract pipeline out of `server.ts`) is DONE — `src/pipeline.ts` exports `createProcessor`, `src/browser.ts` exports `renderMarkdown`, and `npm run bundle:render` produces a clean 866kb browser bundle (`assets/glint-render.bundle.js`, global `GlintRender`). No `node:` builtins in the browser graph (grep hits were `(node: Node)` type annotations). One residual: `src/browser.ts:16` `DEFAULT_CONFIG` uses the server `storage` config shape — Task 8 fixes that when providers are deleted.

---

### Task 1: Pure section-range math + DOM resolver (issue #8 money path)

The editor's "which source lines does this section own?" logic. `rehype-glint-sections.ts` already wraps h2–h6 content into `<section class="glint-section level-N" data-section-line=N>`; **h1 content and preamble live outside any section** (see `rehype-glint-sections.ts:66`). The pure core is line math (node-testable, no DOM dep); the DOM wrapper is a thin gatherer with a manual smoke note.

**Files:**
- Create: `src/spa/editor/section-range.ts`
- Test: `src/tests/section-range.test.ts`

**Interfaces:**
- Consumes: nothing (leaf).
- Produces:
  - `interface SectionRange { startLine: number; endLine: number; }` — 1-indexed, `endLine` exclusive.
  - `sectionRangeFromLines(startLine: number, laterSectionLines: number[], eof: number): SectionRange` — pure. `startLine` = this section's `data-section-line`; `laterSectionLines` = the source lines of every following section at the **same or shallower** heading level (caller filters); `eof` = total line count + 1. Returns `{ startLine, endLine }` where `endLine` = smallest entry in `laterSectionLines` greater than `startLine`, else `eof`.
  - `getSectionRange(section: HTMLElement, eof: number): SectionRange` — DOM wrapper. Reads `section.dataset.sectionLine` for `startLine`; gathers `laterSectionLines` by walking `.glint-section` elements after `section` whose `level-N` class is `<=` this section's level; delegates to `sectionRangeFromLines`. If `section` has no `data-section-line` (preamble/H1 gap), falls back to `{ startLine: 1, endLine: firstSectionLine ?? eof }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/tests/section-range.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sectionRangeFromLines } from '../spa/editor/section-range.js';

test('mid-doc section ends at next same-or-shallower section', () => {
    // section at line 10; later sections at 25 (deeper, ignored by caller) not included here
    const r = sectionRangeFromLines(10, [25, 40], 100);
    assert.deepEqual(r, { startLine: 10, endLine: 25 });
});

test('last section runs to EOF', () => {
    const r = sectionRangeFromLines(40, [], 100);
    assert.deepEqual(r, { startLine: 40, endLine: 100 });
});

test('ignores later lines that precede startLine', () => {
    const r = sectionRangeFromLines(40, [10, 55], 100);
    assert.deepEqual(r, { startLine: 40, endLine: 55 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `tsx --test src/tests/section-range.test.ts`
Expected: FAIL — `Cannot find module '../spa/editor/section-range.js'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/spa/editor/section-range.ts
export interface SectionRange { startLine: number; endLine: number; }

export function sectionRangeFromLines(startLine: number, laterSectionLines: number[], eof: number): SectionRange {
    const after = laterSectionLines.filter((l) => l > startLine).sort((a, b) => a - b);
    return { startLine, endLine: after.length ? after[0] : eof };
}

function levelOf(section: Element): number {
    for (const c of Array.from(section.classList)) {
        const m = c.match(/^level-(\d)$/);
        if (m) return parseInt(m[1], 10);
    }
    return 0;
}

export function getSectionRange(section: HTMLElement, eof: number): SectionRange {
    const startAttr = section.dataset.sectionLine;
    const wrapper = section.closest('.content-wrapper') ?? document.body;
    const sections = Array.from(wrapper.querySelectorAll<HTMLElement>('.glint-section[data-section-line]'));

    if (!startAttr) {
        const first = sections[0]?.dataset.sectionLine;
        return { startLine: 1, endLine: first ? parseInt(first, 10) : eof };
    }
    const startLine = parseInt(startAttr, 10);
    const myLevel = levelOf(section);
    const idx = sections.indexOf(section);
    const laterSectionLines = sections
        .slice(idx + 1)
        .filter((s) => levelOf(s) <= myLevel)
        .map((s) => parseInt(s.dataset.sectionLine!, 10));
    return sectionRangeFromLines(startLine, laterSectionLines, eof);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `tsx --test src/tests/section-range.test.ts`
Expected: PASS (3 tests). `getSectionRange` (DOM) is exercised manually in Task 3's smoke check — no jsdom dep added.

- [ ] **Step 5: Commit**

```bash
git add src/spa/editor/section-range.ts src/tests/section-range.test.ts
git commit -m "feat(spa): pure section-range math + DOM resolver (#8)"
```

---

### Task 2: Storage seam + FakeAdapter + contract tests

The one abstraction everything pivots on. Pure in-memory, fully node-testable.

**Files:**
- Create: `src/spa/storage/types.ts`, `src/spa/storage/fake.ts`
- Test: `src/tests/fake-adapter.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface FileMeta { id: string; name: string; path: string; version: string; }`
  - `interface StorageAdapter { auth(): Promise<void>; identity(): { name: string }; list(): Promise<FileMeta[]>; read(id: string): Promise<{ content: string; version: string }>; write(id: string, content: string, version: string): Promise<{ version: string }>; }`
  - `class ConflictError extends Error` — thrown by `write` on stale `version`.
  - `class FakeAdapter implements StorageAdapter` — ctor takes `initial?: { name: string; content: string }[]`; `version` is a monotonic integer-as-string bumped on each write.

- [ ] **Step 1: Write the failing test**

```ts
// src/tests/fake-adapter.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeAdapter, ConflictError } from '../spa/storage/fake.js';

test('list + read round-trip', async () => {
    const a = new FakeAdapter([{ name: 'a.md', content: '# A' }]);
    const files = await a.list();
    assert.equal(files.length, 1);
    const { content, version } = await a.read(files[0].id);
    assert.equal(content, '# A');
    assert.ok(version);
});

test('write with current version succeeds and bumps version', async () => {
    const a = new FakeAdapter([{ name: 'a.md', content: '# A' }]);
    const [f] = await a.list();
    const { version } = await a.read(f.id);
    const res = await a.write(f.id, '# B', version);
    assert.notEqual(res.version, version);
    assert.equal((await a.read(f.id)).content, '# B');
});

test('write with stale version throws ConflictError', async () => {
    const a = new FakeAdapter([{ name: 'a.md', content: '# A' }]);
    const [f] = await a.list();
    const { version } = await a.read(f.id);
    await a.write(f.id, '# B', version);           // bumps
    await assert.rejects(() => a.write(f.id, '# C', version), ConflictError);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `tsx --test src/tests/fake-adapter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/spa/storage/types.ts
export interface FileMeta { id: string; name: string; path: string; version: string; }
export interface StorageAdapter {
    auth(): Promise<void>;
    identity(): { name: string };
    list(): Promise<FileMeta[]>;
    read(id: string): Promise<{ content: string; version: string }>;
    write(id: string, content: string, version: string): Promise<{ version: string }>;
}
export class ConflictError extends Error {
    constructor(msg = 'stale version') { super(msg); this.name = 'ConflictError'; }
}
```

```ts
// src/spa/storage/fake.ts
import { StorageAdapter, FileMeta, ConflictError } from './types.js';

interface Entry { meta: FileMeta; content: string; v: number; }

export { ConflictError };

export class FakeAdapter implements StorageAdapter {
    private entries = new Map<string, Entry>();
    private seq = 0;

    constructor(initial: { name: string; content: string }[] = []) {
        for (const it of initial) {
            const id = `f${++this.seq}`;
            this.entries.set(id, {
                meta: { id, name: it.name, path: it.name, version: '1' },
                content: it.content, v: 1,
            });
        }
    }
    async auth() {}
    identity() { return { name: 'Fake User' }; }
    async list(): Promise<FileMeta[]> { return [...this.entries.values()].map((e) => ({ ...e.meta })); }
    async read(id: string) {
        const e = this.entries.get(id);
        if (!e) throw new Error(`no such file: ${id}`);
        return { content: e.content, version: String(e.v) };
    }
    async write(id: string, content: string, version: string) {
        const e = this.entries.get(id);
        if (!e) throw new Error(`no such file: ${id}`);
        if (String(e.v) !== version) throw new ConflictError();
        e.v += 1; e.content = content; e.meta.version = String(e.v);
        return { version: String(e.v) };
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `tsx --test src/tests/fake-adapter.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/spa/storage/types.ts src/spa/storage/fake.ts src/tests/fake-adapter.test.ts
git commit -m "feat(spa): storage seam + FakeAdapter + contract tests"
```

---

### Task 3: Section-as-unit editor orchestration (against the seam)

Rewrite of the brittle `src/client/editor-sessions.ts` line-mapping (issue #8) as SPA-native orchestration: locate the current section from the viewport, edit its subtree, save via `adapter.write` with optimistic locking. Reuses the `GlintEditor` CodeMirror widget (`src/client/editor.ts`) unchanged.

**Files:**
- Create: `src/spa/editor/session.ts`
- Test: manual smoke (browser) — see Step 5; the pure boundary math is already covered by Task 1.

**Interfaces:**
- Consumes: `getSectionRange`, `SectionRange` (Task 1); `StorageAdapter`, `ConflictError` (Task 2); global `GlintEditor` (`src/client/editor.ts`, exposed on `window`).
- Produces:
  - `function getCurrentSection(headerOffset?: number): HTMLElement | null` — topmost `.glint-section` whose `getBoundingClientRect().bottom > headerOffset` (default 0); falls back to the first `[data-source-line]` block (preamble). No mouse dependency.
  - `async function openSectionEditor(adapter: StorageAdapter, fileId: string, section: HTMLElement): Promise<void>` — reads source via `adapter.read`, slices `getSectionRange(section, eof)`, hides the section subtree, mounts `GlintEditor`, wires save/cancel.
  - `function closeSectionEditor(): void` — destroys editor, restores hidden nodes.

- [ ] **Step 1: Write `getCurrentSection` + `closeSectionEditor` (viewport resolver, no silent-fail)**

```ts
// src/spa/editor/session.ts
import { getSectionRange } from './section-range.js';
import { StorageAdapter, ConflictError } from '../storage/types.js';

let active: any = null;                 // GlintEditor instance
let container: HTMLElement | null = null;
let hidden: HTMLElement[] = [];

export function getCurrentSection(headerOffset = 0): HTMLElement | null {
    const wrapper = document.querySelector('.content-wrapper') ?? document.body;
    const sections = Array.from(wrapper.querySelectorAll<HTMLElement>('.glint-section'));
    for (const s of sections) {
        if (s.getBoundingClientRect().bottom > headerOffset) return s;
    }
    return wrapper.querySelector<HTMLElement>('[data-source-line]');
}

export function closeSectionEditor(): void {
    if (active) { active.destroy(); active = null; }
    if (container) { container.remove(); container = null; }
    hidden.forEach((el) => (el.style.display = ''));
    hidden = [];
}
```

- [ ] **Step 2: Add `openSectionEditor` (section-as-unit edit + optimistic-lock save)**

```ts
export async function openSectionEditor(adapter: StorageAdapter, fileId: string, section: HTMLElement): Promise<void> {
    if (active && !confirm('Discard the open editor?')) return;
    closeSectionEditor();

    const { content, version } = await adapter.read(fileId);
    const lines = content.split('\n');
    const eof = lines.length + 1;
    const { startLine, endLine } = getSectionRange(section, eof);
    const sectionText = lines.slice(startLine - 1, endLine - 1).join('\n');

    // Hide the section's own subtree (no ±5 buffer, no global heading scan).
    hidden = [section];
    section.style.display = 'none';
    container = document.createElement('div');
    container.className = 'glint-inline-editor-container';
    section.parentNode!.insertBefore(container, section);

    if (typeof (window as any).GlintEditor === 'undefined') {
        closeSectionEditor();
        throw new Error('Editor not loaded');
    }
    active = new (window as any).GlintEditor(container, {
        initialValue: sectionText,
        vimMode: true,
        onSave: async (edited: string) => {
            const next = [...lines];
            next.splice(startLine - 1, endLine - startLine, edited);
            try {
                await adapter.write(fileId, next.join('\n'), version);
                location.reload();
            } catch (e) {
                if (e instanceof ConflictError) {
                    alert('This file changed on the backend. Reloading to show the latest.');
                    location.reload();
                } else {
                    alert(`Save failed: ${(e as Error).message}`);
                }
            }
        },
        onCancel: closeSectionEditor,
    });
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in `src/spa/editor/session.ts`. (If `tsc` reports the whole project, ensure no *new* errors are introduced.)

- [ ] **Step 4: Wire the keyboard trigger (fail-loud)**

Add to `src/spa/editor/session.ts`:

```ts
export function installEditorShortcuts(adapter: StorageAdapter, currentFileId: () => string | null): void {
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'e' || e.metaKey || e.ctrlKey || e.altKey) return;
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
        const id = currentFileId();
        if (!id) return;
        const section = getCurrentSection(64);
        if (!section) { alert('Scroll to a section first.'); return; }   // never a silent no-op (#8 §2/§4)
        e.preventDefault();
        void openSectionEditor(adapter, id, section);
    });
}
```

- [ ] **Step 5: Manual smoke check (leave-behind note in module header)**

Add a comment block at the top of `session.ts` documenting the manual smoke procedure (Task 4 makes it runnable against FakeAdapter): load a multi-section doc → press `e` mid-doc → assert the editor opens showing exactly that section's source → edit → save → the section re-renders with the change and no neighbor is clobbered. `getSectionRange`'s math is unit-tested (Task 1); this smoke covers the DOM wiring.

- [ ] **Step 6: Commit**

```bash
git add src/spa/editor/session.ts
git commit -m "feat(spa): section-as-unit editor orchestration over the seam (#8)"
```

---

### Task 4: App shell — routing, sidebar, render, wiki-links (against FakeAdapter)

The static page + `src/spa/app.ts` that ties render + sidebar + editor + routing to an adapter. Built and manually verified against `FakeAdapter` first (no backend needed).

**Files:**
- Create: `src/spa/app.ts`, `src/spa/index.html`, `src/spa/wiki-links.ts`
- Test: `src/tests/wiki-resolve.test.ts` (pure link resolution)

**Interfaces:**
- Consumes: `StorageAdapter`, `FileMeta` (Task 2); `renderMarkdown` from `src/browser.ts` (global `GlintRender.renderMarkdown` once bundled); `installEditorShortcuts` (Task 3); `FakeAdapter` (Task 2).
- Produces:
  - `function resolveWikiLink(name: string, files: FileMeta[]): FileMeta | null` — matches `[[Name]]` against `files` by filename (case-insensitive, with/without `.md`).
  - `function parseRoute(hash: string): { backend: string; rest: string[] } | null` — parses `#/gh/owner/repo/path`, `#/drive/<folderId>`, `#/local`, `#/fake`.
  - `async function boot(): Promise<void>` — reads `location.hash`, picks the adapter, `auth()` → `list()` → renders sidebar + entry file.

- [ ] **Step 1: Write the failing wiki-resolve test**

```ts
// src/tests/wiki-resolve.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWikiLink } from '../spa/wiki-links.js';

const files = [
    { id: '1', name: 'Getting Started.md', path: 'Getting Started.md', version: '1' },
    { id: '2', name: 'notes.md', path: 'sub/notes.md', version: '1' },
];

test('resolves by basename without extension, case-insensitive', () => {
    assert.equal(resolveWikiLink('getting started', files)?.id, '1');
    assert.equal(resolveWikiLink('Notes', files)?.id, '2');
});
test('returns null for unknown link', () => {
    assert.equal(resolveWikiLink('missing', files), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `tsx --test src/tests/wiki-resolve.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `wiki-links.ts`**

```ts
// src/spa/wiki-links.ts
import { FileMeta } from './storage/types.js';

export function resolveWikiLink(name: string, files: FileMeta[]): FileMeta | null {
    const want = name.trim().toLowerCase().replace(/\.md$/, '');
    for (const f of files) {
        const base = f.name.toLowerCase().replace(/\.md$/, '');
        if (base === want) return f;
    }
    return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `tsx --test src/tests/wiki-resolve.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write `app.ts` (route parse + boot against FakeAdapter)**

```ts
// src/spa/app.ts
import { StorageAdapter, FileMeta } from './storage/types.js';
import { FakeAdapter } from './storage/fake.js';
import { resolveWikiLink } from './wiki-links.js';
import { installEditorShortcuts } from './editor/session.js';

declare const GlintRender: { renderMarkdown(src: string, opts?: any): Promise<string> };

export function parseRoute(hash: string): { backend: string; rest: string[] } | null {
    const m = hash.replace(/^#\/?/, '');
    if (!m) return null;
    const parts = m.split('/').filter(Boolean);
    if (!parts.length) return null;
    return { backend: parts[0], rest: parts.slice(1) };
}

function pickAdapter(backend: string): StorageAdapter {
    switch (backend) {
        case 'fake': return new FakeAdapter([
            { name: 'Home.md', content: '# Home\n\nSee [[Notes]].' },
            { name: 'Notes.md', content: '## Notes\n\nHello from notes.' },
        ]);
        // 'drive' | 'github' | 'local' wired in Tasks 5–7
        default: throw new Error(`unknown backend: ${backend}`);
    }
}

let currentFileId: string | null = null;
let files: FileMeta[] = [];
let adapter: StorageAdapter;

async function openFile(id: string) {
    currentFileId = id;
    const { content } = await adapter.read(id);
    const knownPaths = files.map((f) => f.name);
    const html = await GlintRender.renderMarkdown(content, { knownPaths });
    (document.querySelector('.content-wrapper') as HTMLElement).innerHTML = html;
    wireWikiLinks();
}

function wireWikiLinks() {
    document.querySelectorAll<HTMLElement>('a[data-wiki-link]').forEach((a) => {
        a.addEventListener('click', (e) => {
            e.preventDefault();
            const target = resolveWikiLink(a.textContent || '', files);
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
    if (files.length) await openFile(files[0].id);
}

window.addEventListener('DOMContentLoaded', () => void boot());
window.addEventListener('focus', () => { if (currentFileId) void openFile(currentFileId); }); // refetch-on-focus, replaces SSE
```

- [ ] **Step 6: Write `index.html` (static host shell)**

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Glint</title>
  <link rel="stylesheet" href="./assets/layout.css">
  <link rel="stylesheet" href="./assets/highlight.css">
  <link rel="stylesheet" href="./assets/themes/nord.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16/dist/katex.min.css">
</head>
<body>
  <nav class="sidebar"></nav>
  <main class="content"><div class="content-wrapper"></div></main>
  <script src="./assets/glint-render.bundle.js"></script>
  <script src="./assets/editor.bundle.js"></script>
  <script type="module" src="./assets/spa.bundle.js"></script>
</body>
</html>
```

- [ ] **Step 7: Add SPA bundle script + build**

Add to `package.json` scripts (`bundle:spa`), and include it in `bundle`:

```json
"bundle:spa": "esbuild src/spa/app.ts --bundle --minify --format=esm --outfile=assets/spa.bundle.js",
```

Append `&& npm run bundle:spa` to the existing `"bundle"` script.

Run: `npm run bundle:spa && npm run bundle:render && npm run bundle:editor`
Expected: three bundles emitted, no errors.

- [ ] **Step 8: Manual smoke — serve the static dir and load `#/fake`**

Run: `python3 -m http.server 8080 --directory .` then open `http://localhost:8080/src/spa/index.html#/fake` (adjust asset paths if needed — Task 9 finalizes the deploy layout).
Confirm: sidebar lists Home.md + Notes.md; Home renders; clicking the `[[Notes]]` link navigates; pressing `e` on a section opens the editor; save mutates the FakeAdapter in memory (persists until reload). This exercises Task 3's DOM wiring end-to-end.

- [ ] **Step 9: Commit**

```bash
git add src/spa/app.ts src/spa/index.html src/spa/wiki-links.ts src/tests/wiki-resolve.test.ts package.json
git commit -m "feat(spa): app shell — routing, sidebar, render, wiki-links (FakeAdapter)"
```

---

### Task 5: Drive adapter (SPIKE FIRST — #1 build risk)

Google Drive backend via GIS token client + Drive REST. **The `drive.file` folder-listing risk is the highest unknown in the whole project** — spike it before writing the adapter, and escalate to the user if it fails.

**Files:**
- Create: `spike/drive-folder-listing.html` (throwaway probe), `src/spa/storage/drive.ts`
- Modify: `src/spa/app.ts` (add `'drive'` case to `pickAdapter`)

**Interfaces:**
- Consumes: `StorageAdapter`, `FileMeta`, `ConflictError` (Task 2).
- Produces: `class DriveAdapter implements StorageAdapter` — ctor `(folderId: string, clientId: string)`.

REST calls (verbatim from the proven `spike/drive-spa.html`, base `https://www.googleapis.com`):
- list: `GET /drive/v3/files?q='{folderId}'+in+parents+and+name+contains+'.md'&fields=files(id,name,modifiedTime)&pageSize=100&orderBy=modifiedTime desc`
- read: `GET /drive/v3/files/{id}?alt=media` (body) + `GET /drive/v3/files/{id}?fields=modifiedTime` (version)
- write pre-check: `GET /drive/v3/files/{id}?fields=modifiedTime` → if != passed `version`, throw `ConflictError`
- write: `PATCH /upload/drive/v3/files/{id}?uploadType=media&fields=modifiedTime` with the new body → returns new `modifiedTime` as `version`
- auth: GIS `google.accounts.oauth2.initTokenClient({ client_id, scope: 'https://www.googleapis.com/auth/drive.file' })` + Google Picker for folder selection.

- [ ] **Step 1: Spike `drive.file` folder-child listing**

Write `spike/drive-folder-listing.html`: GIS token with **`drive.file`** scope only, use Google Picker to let the user pick a folder, then attempt the `files?q='{folderId}'+in+parents` list above. Log the result count and each filename.

- [ ] **Step 2: Run the spike and record a verdict**

Serve `spike/` over `localhost` (OAuth needs a real origin; `file://` won't work — spec §Build). Pick a Drive folder containing `.md` files. Record in the spike file's header comment: **GREEN** (children enumerated under `drive.file`) or **RED** (empty/403).

**BRANCH — if RED: STOP.** Do not build the adapter. Escalate to the user with the two documented fallbacks from the spec §Risks (1: `drive.readonly` + `drive.file` combo; 2: a broader scope with the verification tradeoff). The scope decision is the user's, not the implementer's.

- [ ] **Step 3: Write `DriveAdapter` (only if GREEN)**

Implement `StorageAdapter` with the REST calls above. `version` = `modifiedTime` string. `write` does the pre-check GET, throws `ConflictError` on mismatch, then PATCHes. `identity()` returns the Google account name from the GIS userinfo (or a cached value from the token flow). `auth()` resolves once a token is obtained.

- [ ] **Step 4: Typecheck + wire into app**

Add `case 'drive': return new DriveAdapter(route.rest[0], DRIVE_CLIENT_ID);` to `pickAdapter`. Run `npx tsc --noEmit` — no new errors.

- [ ] **Step 5: Manual smoke checklist**

Serve over localhost, load `#/drive/<folderId>`: auth popup → sidebar lists folder `.md` files → open one → edit a section → save → reload → change persisted in Drive. Conflict: edit the file in Drive UI mid-session, then save → `ConflictError` path reloads.

- [ ] **Step 6: Commit**

```bash
git add spike/drive-folder-listing.html src/spa/storage/drive.ts src/spa/app.ts
git commit -m "feat(spa): Drive adapter (drive.file + Picker, spike GREEN)"
```

---

### Task 6: GitHub adapter (device flow)

GitHub backend via OAuth **device flow** (no client secret — works from static) + Contents API.

**Files:**
- Create: `src/spa/storage/github.ts`
- Modify: `src/spa/app.ts` (`'github'` case)

**Interfaces:**
- Consumes: seam types (Task 2).
- Produces: `class GitHubAdapter implements StorageAdapter` — ctor `(owner: string, repo: string, path: string, ref: string, clientId: string)`.

REST (base `https://api.github.com`, `Authorization: Bearer <token>`):
- device code: `POST https://github.com/login/device/code` (`client_id`, `scope=repo`) → `device_code`, `user_code`, `verification_uri`, `interval`.
- poll: `POST https://github.com/login/oauth/access_token` (`client_id`, `device_code`, `grant_type=urn:ietf:params:oauth:grant-type:device_code`) until `access_token`. Cache in `localStorage['glint-gh-token']`.
- list: `GET /repos/{owner}/{repo}/contents/{path}?ref={ref}` → array; keep `.md` entries; `version` = each entry's `sha`.
- read: `GET /repos/{owner}/{repo}/contents/{path}?ref={ref}` → base64 `content` + `sha`.
- write: `PUT /repos/{owner}/{repo}/contents/{path}` with `{ message, content: base64, sha, branch: ref }`. A stale `sha` returns HTTP 409 → throw `ConflictError`.
- identity: `GET /user` → `.name || .login`.

- [ ] **Step 1: Implement `GitHubAdapter`**

Implement the seam. `auth()` runs the device flow (or reuses the cached token, validating with `GET /user`); surface the `user_code` + `verification_uri` in the UI (a simple `alert`/modal is fine for v1). Base64 encode/decode via `btoa`/`atob` with UTF-8 safety (`TextEncoder`/`TextDecoder`).

- [ ] **Step 2: Typecheck + wire into app**

`case 'github': return new GitHubAdapter(rest[0], rest[1], rest.slice(2).join('/'), 'main', GH_CLIENT_ID);` Run `npx tsc --noEmit`.

- [ ] **Step 3: Manual smoke checklist**

Load `#/gh/owner/repo/path`: device-flow prompt → enter code at github.com → sidebar lists repo `.md` → open → edit → save (commit appears in repo, attributed to the authenticated user) → reload persists. Confirm private-repo read+write works (spec §Risk 2). Conflict: push a change to the file, then save → 409 → `ConflictError` reload.

- [ ] **Step 4: Commit**

```bash
git add src/spa/storage/github.ts src/spa/app.ts
git commit -m "feat(spa): GitHub adapter (device flow + Contents API)"
```

---

### Task 7: Local adapter (File System Access API)

Local directory backend — Chromium/Edge only. Retires the last reason `serve` exists.

**Files:**
- Create: `src/spa/storage/local.ts`
- Modify: `src/spa/app.ts` (`'local'` case + feature-detect to hide when unsupported)

**Interfaces:**
- Consumes: seam types (Task 2).
- Produces:
  - `class LocalAdapter implements StorageAdapter` — `auth()` calls `showDirectoryPicker()` (or restores a persisted handle from IndexedDB, re-requesting permission).
  - `function localSupported(): boolean` — `'showDirectoryPicker' in window`.

- [ ] **Step 1: Implement `LocalAdapter`**

`auth()`: restore `FileSystemDirectoryHandle` from IndexedDB (key `glint-dir-handle`); if present, `queryPermission({ mode: 'readwrite' })` and `requestPermission` if not granted; else `showDirectoryPicker({ mode: 'readwrite' })` and persist the handle. `list()`: iterate the directory handle for `.md` files; `id` = filename, `version` = `file.lastModified` as string. `read()`: `getFileHandle(id).getFile()` → text + `lastModified`. `write()`: re-read `lastModified`; if != `version` throw `ConflictError`; else `createWritable()` → write → return new `lastModified`.

- [ ] **Step 2: Typecheck + wire + feature-detect**

`case 'local': return new LocalAdapter();` In `renderSidebar`/entry UI, hide the local option when `!localSupported()`. Run `npx tsc --noEmit` (add `lib: ["DOM"]` types are already present; FS Access types may need `// @ts-expect-error` or a minimal ambient decl — keep it minimal, ponytail).

- [ ] **Step 3: Manual smoke checklist (Chromium)**

Load `#/local`: directory picker → grant → sidebar lists `.md` → open → edit → save → file on disk updated → reload (re-permission prompt) → handle restored, change persisted. Confirm the local option is hidden in a non-Chromium browser (spec §Risk 3).

- [ ] **Step 4: Commit**

```bash
git add src/spa/storage/local.ts src/spa/app.ts
git commit -m "feat(spa): Local adapter (File System Access API, Chromium)"
```

---

### Task 8: Delete `serve` + server stack; fix config leak

Retire the server surface the SPA replaces. Keep the pipeline, `glint render` CLI, `editor.ts`, and rendering widgets.

**Files:**
- Delete: `src/server.ts`, `src/server/` (auth.ts, sse.ts, routes/), `src/storage/` server providers (`local.ts`, `git.ts`, `git-utils.ts`, `cache.ts`, `index.ts`, `types.ts` — audit each import first), and the `serve` command in `src/cli.ts`.
- Modify: `src/browser.ts` (replace server-shaped `DEFAULT_CONFIG`), `src/config.ts` (drop `storage`/`port`/`host` if nothing else needs them), `src/cli.ts`, `package.json` (`dev`/`start` scripts drop `serve`).
- Test: delete now-dead server/storage tests (`server.test.ts`, `storage.test.ts`, `documents.test.ts`, `webhooks.test.ts` — audit each).

- [ ] **Step 1: Introduce a minimal SPA/render config in `browser.ts`**

Replace `browser.ts` `DEFAULT_CONFIG` (currently the full server `GlintConfig` with `storage`) so `createProcessor` no longer needs server config. Give `createProcessor` a narrowed config type `{ theme?: string; 'latex-macros'?: Record<string,string> }` if `config.ts`'s `GlintConfig` is being trimmed. Confirm `src/render.ts` (the CLI renderer) still compiles against whatever `createProcessor` now accepts.

```ts
// src/browser.ts — replace DEFAULT_CONFIG usage
const config = { theme: opts.theme ?? 'nord', 'latex-macros': opts.macros };
const processor = createProcessor(config as any, (p) => knownSet.has(p)); // narrow the cast once GlintConfig is trimmed
```

- [ ] **Step 2: Grep for all references before deleting**

Run: `grep -rn "server\.js\|/server/\|storage/index\|StorageManager\|createServer\|serve" src/ --include=*.ts | grep -v spa/`
For each hit, either it's dead (delete) or a live dependency of the kept pipeline/CLI (do not delete — note it). List the survivors.

- [ ] **Step 3: Delete the server + storage-provider files and their tests**

Delete the files listed above whose only consumers were the server. Delete the `serve` subcommand from `src/cli.ts`, keeping `render`.

- [ ] **Step 4: Fix `package.json` scripts**

`dev` and `start` currently run `serve`. Replace with SPA-oriented equivalents (e.g. `dev` → `esbuild --watch` the SPA bundles + `python3 -m http.server`, or drop `dev`/`start` and document the static-serve command). Keep `build`, `bundle*`, `test`.

- [ ] **Step 5: Verify the build + full test suite**

Run: `npm run build` — `tsc` clean, all bundles emit.
Run: `tsx --test src/tests/section-range.test.ts src/tests/fake-adapter.test.ts src/tests/wiki-resolve.test.ts src/tests/render.test.ts src/tests/render-static.test.ts` (the kept suites).
Expected: all PASS. (Note: `npm test` may hang on removed server tests — run the surviving files explicitly per CLAUDE.md.)

- [ ] **Step 6: Commit**

```bash
git add -A src/ package.json
git commit -m "refactor: retire glint serve + server/storage stack (SPA supersedes)"
```

---

### Task 9: Build config + GitHub Pages deploy

Ship the static SPA to GitHub Pages.

**Files:**
- Create: `.github/workflows/pages.yml`, a deploy layout (SPA `index.html` + `assets/` at a servable root).
- Modify: `package.json` (`build` includes `bundle:spa`), `README.md`/docs (how to point the SPA at a workspace; OAuth client setup).

- [ ] **Step 1: Decide the deploy root layout**

Choose a `dist-spa/` (or `docs/`) directory the Pages workflow publishes: copy `src/spa/index.html` → root, `assets/*.bundle.js` + `assets/*.css` + `assets/themes/` under `./assets/`. Fix the `index.html` asset hrefs to match. Add a build step `bundle:spa:dist` that assembles it.

- [ ] **Step 2: Write the Pages workflow**

`.github/workflows/pages.yml`: on push to `main`, `npm ci && npm run build && <assemble dist>`, then `actions/upload-pages-artifact` + `actions/deploy-pages`.

- [ ] **Step 3: Document OAuth client setup (wizard-style)**

In `README.md` (or `docs/spa-setup.md`): Google OAuth client — authorized JS origin = the Pages origin, consent screen in Testing + explicit test users; GitHub OAuth App with device flow enabled. Record the two client IDs the adapters read (`DRIVE_CLIENT_ID`, `GH_CLIENT_ID`) — inject them at build time or via a small `config.js` the page loads (client IDs are public; safe to commit).

- [ ] **Step 4: Verify deploy**

Push to `main`, let the workflow run, load the Pages URL, and run the Drive smoke checklist against the real origin (OAuth needs the registered origin, not localhost). Confirm one full round-trip (auth → list → open → edit → save → persist) on the deployed site.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/pages.yml package.json README.md
git commit -m "chore(spa): GitHub Pages deploy + OAuth setup docs"
```

---

## Self-Review

**Spec coverage:**
- Storage seam → Task 2. ✅ (types match spec §Storage seam verbatim)
- Drive / GitHub / Local adapters → Tasks 5/6/7, each spike-gated where the spec demands. ✅
- Section-as-unit editor (#8) → Tasks 1 + 3; `getSectionRange` leave-behind test → Task 1. ✅
- App shell, workspace-as-URL, wiki-links → Task 4. ✅
- Refetch-on-focus replaces SSE → Task 4 Step 5. ✅
- Retire serve + delete server/storage/SSE → Task 8. ✅
- Pipeline extraction prerequisite → pre-verified DONE (Global Constraints). ✅
- Pages deploy + OAuth client setup → Task 9. ✅
- Non-goals (task/journal aggregation, realtime, non-Chromium local) → respected; aggregation code removed with the server in Task 8. ✅

**Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N" — each code step carries real content; adapter REST calls are verbatim from spec/spike.

**Type consistency:** `StorageAdapter`/`FileMeta`/`ConflictError` defined in Task 2 and consumed unchanged in Tasks 3–8. `SectionRange`/`getSectionRange`/`sectionRangeFromLines` consistent between Task 1 and Task 3. `resolveWikiLink` signature consistent Task 4. `renderMarkdown(src, {knownPaths})` matches `src/browser.ts`.

**Known open item flagged for the executor:** Task 5 Step 2 is a hard STOP-and-escalate branch — the Drive scope decision is the user's if the spike is RED.

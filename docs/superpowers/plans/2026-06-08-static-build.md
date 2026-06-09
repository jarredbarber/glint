# Static Build (`glint build`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `glint build [path] --out dist` command that emits a static, read-only HTML snapshot of a Glint wiki that works on any dumb file host.

**Architecture:** Reuse the existing pure render path (`createProcessor` → `parseMarkdown` → `renderer.renderHtml`). A new `buildSite()` walks the content dir via `StorageManager`/`buildFileTree`, renders each `.md` to `dist/<path>/index.html` (directory-per-page), rewrites app URLs (`/f/*`, `/api/asset/resolve`) to static equivalents with a single post-render pass, and copies kept client bundles + per-article `.md.assets/` folders. The renderer gains a `static` flag that ships only read-only client bundles and suppresses edit/share/comment chrome.

**Tech Stack:** Node ESM, TypeScript (strict), unified pipeline (unchanged), Commander CLI, Node native test runner (`tsx --test`).

---

## File Structure

- `src/url-rewrite.ts` — **NEW.** Pure function `rewriteStaticHtml(html)`: maps `/f/<p>(.md)` → `/<p>/`, `/api/asset/resolve?path&context` → absolute static asset path. No I/O.
- `src/build.ts` — **NEW.** `buildSite(opts)`: orchestration (enumerate, render, rewrite, write, copy).
- `src/cli.ts` — **MODIFY.** Add `build` subcommand.
- `src/renderer.ts` — **MODIFY.** Add `static?: boolean` to `RenderOptions`; force `access='view'`, suppress share modal, thread flag to sidebar/breadcrumbs/scripts.
- `src/renderer/scripts.ts` — **MODIFY.** `renderScripts` gains `isStatic` param → emit only read-only bundle set.
- `src/renderer/sidebar.ts` — **MODIFY.** `SidebarOptions.static?` → hide Share button + vim toggle.
- `src/renderer/breadcrumbs.ts` — **MODIFY.** Omit the `?raw=true` Raw link when static.
- `src/tests/url-rewrite.test.ts` — **NEW.** Unit tests for the rewrite mapping.
- `src/tests/render-static.test.ts` — **NEW.** Unit test for `renderScripts` static branch.
- `src/tests/build.test.ts` — **NEW.** Integration test against a fixture wiki in a temp dir.

---

## Task 1: URL rewrite function

**Files:**
- Create: `src/url-rewrite.ts`
- Test: `src/tests/url-rewrite.test.ts`

Rationale for the mapping (from the current code):
- Sidebar/wiki/breadcrumb page links are `/f/<contentPath>` or `/f/<contentPath>.md` (e.g. `src/filetree.ts:93`, wiki-link output). Static target: `/<contentPath-without-.md>/`.
- Images render as `/api/asset/resolve?path=P&context=C` (`src/rehype-glint-image.ts:143`). The server resolves the file as `join(dirname(C), P)` relative to content root (`src/server/routes/api.ts:51-55`). Static target: `/` + that joined POSIX path (assets are copied to the mirrored content-relative location).
- `#anchors`, external `http(s)`/`data:` URLs, and `/assets/...` (bundles/themes/katex) pass through unchanged.

- [ ] **Step 1: Write the failing test**

```ts
// src/tests/url-rewrite.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rewriteStaticHtml } from '../url-rewrite.js';

test('rewrites /f/ page links with .md to directory-per-page', () => {
    assert.equal(
        rewriteStaticHtml('<a href="/f/foo/bar.md">x</a>'),
        '<a href="/foo/bar/">x</a>'
    );
});

test('rewrites extensionless /f/ page links', () => {
    assert.equal(
        rewriteStaticHtml('<a href="/f/foo/bar">x</a>'),
        '<a href="/foo/bar/">x</a>'
    );
});

test('rewrites /api/asset/resolve to mirrored static asset path', () => {
    const html = '<img src="/api/asset/resolve?path=bar.md.assets%2Fimg.png&context=foo%2Fbar.md">';
    assert.equal(
        rewriteStaticHtml(html),
        '<img src="/foo/bar.md.assets/img.png">'
    );
});

test('resolves ./ asset paths against context dir', () => {
    const html = '<img src="/api/asset/resolve?path=.%2Fpic.png&context=notes%2Fa.md">';
    assert.equal(rewriteStaticHtml(html), '<img src="/notes/pic.png">');
});

test('leaves external urls, /assets, and anchors untouched', () => {
    const html =
        '<a href="https://x.com">e</a><link href="/assets/layout.css"><a href="#L12">h</a>';
    assert.equal(rewriteStaticHtml(html), html);
});

test('strips ?raw=true query from any surviving /f/ link', () => {
    assert.equal(
        rewriteStaticHtml('<a href="/f/foo/bar.md?raw=true">r</a>'),
        '<a href="/foo/bar/">r</a>'
    );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `tsx --test src/tests/url-rewrite.test.ts`
Expected: FAIL — `Cannot find module '../url-rewrite.js'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/url-rewrite.ts
import path from 'node:path';

/**
 * Rewrites server-relative app URLs in rendered HTML into static equivalents
 * for a directory-per-page build. Pure: no I/O.
 *
 * - /f/<p>(.md)(?query)      -> /<p-without-.md>/
 * - /api/asset/resolve?...   -> /<join(dirname(context), path)>
 * - everything else          -> unchanged
 */
export function rewriteStaticHtml(html: string): string {
    // Rewrite asset resolver URLs first (they contain query strings).
    html = html.replace(
        /\/api\/asset\/resolve\?([^"'\s>]+)/g,
        (_full, query: string) => {
            const params = new URLSearchParams(query.replace(/&amp;/g, '&'));
            const assetPath = params.get('path') || '';
            const context = params.get('context') || '';
            if (!assetPath) return _full;
            const clean = assetPath.replace(/^\.\//, '');
            const joined = context
                ? path.posix.join(path.posix.dirname(context), clean)
                : clean;
            return '/' + joined.replace(/^\/+/, '');
        }
    );

    // Rewrite /f/ page links (href or src), with optional .md and query.
    html = html.replace(
        /(href|src)="\/f\/([^"?#]*?)(?:\.md)?(?:\?[^"#]*)?(#[^"]*)?"/g,
        (_full, attr: string, p: string, hash = '') => {
            const clean = p.replace(/\/+$/, '');
            return `${attr}="/${clean}/${hash}"`;
        }
    );

    return html;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `tsx --test src/tests/url-rewrite.test.ts`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add src/url-rewrite.ts src/tests/url-rewrite.test.ts
git commit -m "feat(build): add static URL rewrite function"
```

---

## Task 2: Read-only script set in renderScripts

**Files:**
- Modify: `src/renderer/scripts.ts:1` (signature) and `src/renderer/scripts.ts:142-155` (bundle list)
- Test: `src/tests/render-static.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/tests/render-static.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderScripts } from '../renderer/scripts.js';

const KEEP = ['router', 'outline', 'citations', 'lightbox', 'code-blocks', 'mobile-sidebar'];
const DROP = ['upload', 'editor', 'editor-integration', 'share', 'command-palette', 'image-resize'];

test('static mode emits only read-only bundles', () => {
    const out = renderScripts(undefined, [], true);
    for (const name of KEEP) {
        assert.ok(out.includes(`/assets/${name}.bundle.js`), `expected ${name}`);
    }
    for (const name of DROP) {
        assert.ok(!out.includes(`/assets/${name}.bundle.js`), `should drop ${name}`);
    }
});

test('non-static mode still emits the editor bundle', () => {
    const out = renderScripts(undefined, [], false);
    assert.ok(out.includes('/assets/editor.bundle.js'));
});

test('static mode keeps the inline mermaid init script', () => {
    const out = renderScripts(undefined, [], true);
    assert.ok(out.includes('mermaid.initialize'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `tsx --test src/tests/render-static.test.ts`
Expected: FAIL — static mode currently emits `editor.bundle.js` (3rd arg ignored).

- [ ] **Step 3: Write minimal implementation**

Change the signature on `src/renderer/scripts.ts:1` from:

```ts
export const renderScripts = (shareId?: string, extraScripts: string[] = []) => `
```

to:

```ts
export const renderScripts = (shareId?: string, extraScripts: string[] = [], isStatic: boolean = false) => `
```

Then replace the static bundle block (`src/renderer/scripts.ts:142-155`, the 12 `<script src=...>` lines plus the `extraScripts` map) with this single interpolation. Keep everything above line 142 (the inline `<script>` including mermaid init) unchanged:

```ts
${isStatic ? `
<script src="/assets/router.bundle.js"></script>
<script src="/assets/outline.bundle.js"></script>
<script src="/assets/citations.bundle.js"></script>
<script src="/assets/lightbox.bundle.js"></script>
<script src="/assets/code-blocks.bundle.js"></script>
<script src="/assets/mobile-sidebar.bundle.js"></script>
` : `
<script src="/assets/router.bundle.js"></script>
<script src="/assets/upload.bundle.js"></script>
<script src="/assets/editor.bundle.js"></script>
<script src="/assets/editor-integration.bundle.js"></script>
<script src="/assets/outline.bundle.js"></script>
<script src="/assets/image-resize.bundle.js"></script>
<script src="/assets/share.bundle.js"></script>
<script src="/assets/command-palette.bundle.js"></script>
<script src="/assets/citations.bundle.js"></script>
<script src="/assets/lightbox.bundle.js"></script>
<script src="/assets/code-blocks.bundle.js"></script>
<script src="/assets/mobile-sidebar.bundle.js"></script>
`}
${extraScripts.map(s => `<script src="${s}"></script>`).join('\n')}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `tsx --test src/tests/render-static.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/scripts.ts src/tests/render-static.test.ts
git commit -m "feat(build): read-only client bundle set for static render"
```

---

## Task 3: Thread `static` flag through renderer chrome

**Files:**
- Modify: `src/renderer.ts:13-35` (RenderOptions, destructure, body access, share modal gate, calls)
- Modify: `src/renderer/sidebar.ts:5-13` (SidebarOptions) and `src/renderer/sidebar.ts:96` + `:84` region (gate Share button + vim toggle)
- Modify: `src/renderer/breadcrumbs.ts:41` (omit Raw link when static)

No new test here — Task 6's integration test asserts the resulting HTML (no editor/share bundles, no Share button, `data-access="view"`). This task is wiring; keep edits minimal and mechanical.

- [ ] **Step 1: Add `static` to RenderOptions and apply in `renderHtml`**

In `src/renderer.ts`, add to the `RenderOptions` interface (after `styles?: string[];`):

```ts
    static?: boolean;
```

Change the destructure line (`src/renderer.ts:28`) to include `static`:

```ts
    const { content, title, config, fileTree, currentPath, headings = [], frontmatter = {}, access, shareId, scripts = [], styles = [], static: isStatic = false } = options;
```

Change the body tag (`src/renderer.ts:35`) so static forces view access:

```ts
    <body class="${config.theme} ${isShared ? 'shared-view' : ''}" data-access="${isStatic ? 'view' : (access || 'edit')}" data-path="${escapeHtml(currentPath)}">
```

- [ ] **Step 2: Gate the share modal and forward the flag**

In `src/renderer.ts`, change the share-modal conditional (`:106`) from `${!isShared ? `` to:

```ts
    ${(!isShared && !isStatic) ? `
```

Change the sidebar call (`:93`) to pass the flag:

```ts
    ${renderSidebar({ fileTree, currentPath, headings, currentTheme: config.theme, isShared, static: isStatic })}
```

Change the breadcrumbs call (`:96`) to pass the flag:

```ts
            ${!isShared ? renderBreadcrumbs(currentPath, isStatic) : ''}
```

Change the scripts call (`:161`) to pass the flag:

```ts
    ${renderScripts(shareId, scripts, isStatic)}
```

- [ ] **Step 3: Gate sidebar chrome**

In `src/renderer/sidebar.ts`, add `static?: boolean;` to `SidebarOptions` (after `isShared?: boolean;`). In the function body where `isShared` is destructured from options, add a derived flag right after it:

```ts
    const minimalChrome = options.isShared || options.static;
```

Replace the vim-toggle block guard and the Share-button guard (the two `${!isShared ? `` occurrences in the `:84`–`:99` region) with `${!minimalChrome ? ``. Leave the theme switcher and file tree untouched.

- [ ] **Step 4: Omit the Raw breadcrumb when static**

In `src/renderer/breadcrumbs.ts`, change the exported function signature to accept a second arg, e.g.:

```ts
export const renderBreadcrumbs = (currentPath: string, isStatic: boolean = false) => {
```

Wrap the Raw `<li>` (`:41`) so it is omitted when static:

```ts
            ${isStatic ? '' : `<li class="breadcrumb-raw"><a href="/f/${escapeHtml(path)}?raw=true" title="View raw markdown">Raw</a></li>`}
```

(If `path`/`currentUrl` are computed earlier in the function, keep them; only the Raw `<li>` is conditional.)

- [ ] **Step 5: Verify it still compiles**

Run: `npx tsc --noEmit 2>&1 | grep -E "renderer|sidebar|breadcrumbs" || echo "no new renderer errors"`
Expected: `no new renderer errors` (pre-existing unrelated TS errors elsewhere are out of scope — do not fix them here).

- [ ] **Step 6: Commit**

```bash
git add src/renderer.ts src/renderer/sidebar.ts src/renderer/breadcrumbs.ts
git commit -m "feat(build): thread static flag through renderer chrome"
```

---

## Task 4: `buildSite` orchestration

**Files:**
- Create: `src/build.ts`

Reuses: `loadConfig` (`src/config.js`), `StorageManager` (`src/storage/index.js`), `buildFileTree`/`FileNode` (`src/filetree.js`), `parseMarkdown` (`src/markdown.js`), `createProcessor` (`src/server.js`), `renderer.renderHtml` (`src/renderer.js`), `rewriteStaticHtml` (`src/url-rewrite.js`).

Key facts:
- `new StorageManager(config, contentDir)`; methods `read(path)`, `readBuffer(path)`, `list(path)` returning `{ name, type }` entries, `exists(path)`.
- `buildFileTree(storage)` returns `FileNode[]` (posix `path`, `isDir`, `children`), already skipping `assets`/`dist`/hidden.
- `createProcessor(config, linkValidator)` where `linkValidator(p)` returns true if page `p` (ends in `.md`) exists.
- `renderHtml` needs `{ content, title, config, fileTree, currentPath, headings, frontmatter, static: true }`.
- Bundled assets are referenced absolutely as `/assets/...`, so copy the repo `assets/` dir wholesale to `dist/assets/`. Per-article images live in `<file>.md.assets/`.

- [ ] **Step 1: Write `src/build.ts`**

```ts
// src/build.ts
import path from 'node:path';
import fs from 'node:fs/promises';
import { VFile } from 'vfile';
import { loadConfig } from './config.js';
import { StorageManager } from './storage/index.js';
import { buildFileTree, type FileNode } from './filetree.js';
import { parseMarkdown } from './markdown.js';
import { createProcessor } from './server.js';
import * as renderer from './renderer.js';
import { rewriteStaticHtml } from './url-rewrite.js';
import type { HeadingNode } from './rehype-extract-headings.js';

export interface BuildOptions {
    contentDir: string;
    outDir: string;
    configPath?: string;
}

export interface BuildResult {
    pages: number;
    failures: { path: string; error: string }[];
    assetsCopied: number;
}

/** Flatten the file tree into the list of markdown file paths (posix, .md). */
function collectMarkdownPaths(nodes: FileNode[], acc: string[] = []): string[] {
    for (const node of nodes) {
        if (node.isDir) {
            if (node.children) collectMarkdownPaths(node.children, acc);
        } else if (node.path.endsWith('.md')) {
            acc.push(node.path);
        }
    }
    return acc;
}

/** Map a content path like "foo/bar.md" to its output file "foo/bar/index.html". */
function outputHtmlPath(outDir: string, contentPath: string): string {
    const noExt = contentPath.replace(/\.md$/, '');
    return path.join(outDir, noExt, 'index.html');
}

async function writeFile(filePath: string, data: string | Buffer): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data);
}

/** Copy a directory recursively from storage-relative path into dist (mirrored). */
async function copyAssetDir(
    storage: StorageManager,
    relDir: string,
    outDir: string,
    onCopied: () => void
): Promise<void> {
    let entries;
    try {
        entries = await storage.list(relDir);
    } catch {
        return;
    }
    for (const entry of entries) {
        const childRel = `${relDir}/${entry.name}`;
        if (entry.type === 'directory') {
            await copyAssetDir(storage, childRel, outDir, onCopied);
        } else {
            const buf = await storage.readBuffer(childRel);
            await writeFile(path.join(outDir, childRel), buf);
            onCopied();
        }
    }
}

export async function buildSite(opts: BuildOptions): Promise<BuildResult> {
    const config = await loadConfig(opts.contentDir, opts.configPath);
    const storage = new StorageManager(config, opts.contentDir);

    const fileTree = await buildFileTree(storage);
    const mdPaths = collectMarkdownPaths(fileTree);
    const knownPaths = new Set(mdPaths);
    const processor = createProcessor(config, (p) => knownPaths.has(p));

    const result: BuildResult = { pages: 0, failures: [], assetsCopied: 0 };

    // Clean output dir.
    await fs.rm(opts.outDir, { recursive: true, force: true });
    await fs.mkdir(opts.outDir, { recursive: true });

    for (const contentPath of mdPaths) {
        try {
            const raw = await storage.read(contentPath);
            const { content, title: fmTitle, frontmatter, contentStartLine } = parseMarkdown(raw);

            const file = new VFile({ value: content });
            file.data.contentStartLine = contentStartLine;
            file.data.filePath = contentPath;

            const vfile = await processor.process(file);
            const headings = (vfile.data.headings as HeadingNode[]) || [];
            const title = fmTitle || path.basename(contentPath, '.md').replace(/-/g, ' ');

            let html = renderer.renderHtml({
                content: String(vfile),
                title,
                config,
                fileTree,
                currentPath: contentPath,
                headings,
                frontmatter,
                static: true,
            });
            html = rewriteStaticHtml(html);

            await writeFile(outputHtmlPath(opts.outDir, contentPath), html);
            result.pages++;

            if (contentPath === config.baseFile) {
                await writeFile(path.join(opts.outDir, 'index.html'), html);
            }

            // Copy this article's image assets, if any.
            const assetsRel = `${contentPath}.assets`;
            if (await storage.exists(assetsRel)) {
                await copyAssetDir(storage, assetsRel, opts.outDir, () => result.assetsCopied++);
            }
        } catch (err) {
            result.failures.push({ path: contentPath, error: (err as Error).message });
        }
    }

    // Copy bundled client assets (referenced as /assets/...).
    const repoAssets = path.join(import.meta.dirname, '..', 'assets');
    await fs.cp(repoAssets, path.join(opts.outDir, 'assets'), { recursive: true });

    return result;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | grep "build.ts" || echo "build.ts clean"`
Expected: `build.ts clean`.

- [ ] **Step 3: Commit**

```bash
git add src/build.ts
git commit -m "feat(build): add buildSite orchestration"
```

---

## Task 5: CLI `build` subcommand

**Files:**
- Modify: `src/cli.ts` (add a `build` command after the existing `serve` command, before `program.parse()`)

- [ ] **Step 1: Add the command**

Add this import near the top of `src/cli.ts` (after the `createServer` import):

```ts
import { buildSite } from './build.js';
```

Insert this block after the `serve` command's `.action(...)` chain and before `program.parse();`:

```ts
program
    .command('build')
    .description('Build a static HTML snapshot of the wiki')
    .argument('[path]', 'Path to content directory', process.cwd())
    .option('-o, --out <dir>', 'Output directory', 'dist')
    .action(async (contentPath: string, options: { out: string }) => {
        const resolvedPath = path.resolve(contentPath);
        const stats = await fs.stat(resolvedPath);
        let contentDir = resolvedPath;
        let configPath: string | undefined;
        if (stats.isFile()) {
            contentDir = path.dirname(resolvedPath);
            configPath = resolvedPath;
        }
        const outDir = path.resolve(options.out);

        console.log(`Building static site...`);
        console.log(`  content: ${contentDir}`);
        console.log(`  output:  ${outDir}`);

        const result = await buildSite({ contentDir, outDir, configPath });

        console.log(`✓ ${result.pages} pages, ${result.assetsCopied} asset files`);
        if (result.failures.length > 0) {
            console.error(`✗ ${result.failures.length} pages failed:`);
            for (const f of result.failures) console.error(`  ${f.path}: ${f.error}`);
            process.exit(1);
        }
    });
```

- [ ] **Step 2: Smoke-test against the repo's own docs**

Run: `tsx src/cli.ts build docs --out /tmp/glint-smoke && ls /tmp/glint-smoke`
Expected: command prints a page count and `/tmp/glint-smoke` contains `assets/` and `index.html` or nested page dirs. (Exit 0.)

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat(build): add glint build CLI command"
```

---

## Task 6: Integration test against a fixture wiki

**Files:**
- Create: `src/tests/build.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/tests/build.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildSite } from '../build.js';

async function makeFixture(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'glint-fixture-'));
    await fs.writeFile(path.join(dir, 'README.md'), '# Home\n\nSee [[notes/first]].\n');
    await fs.mkdir(path.join(dir, 'notes'), { recursive: true });
    await fs.writeFile(
        path.join(dir, 'notes', 'first.md'),
        '# First\n\nMath $x^2$ and an image:\n\n![pic](first.md.assets/p.png)\n'
    );
    await fs.mkdir(path.join(dir, 'notes', 'first.md.assets'), { recursive: true });
    await fs.writeFile(path.join(dir, 'notes', 'first.md.assets', 'p.png'), 'PNGDATA');
    return dir;
}

test('builds directory-per-page output with rewritten links and copied assets', async () => {
    const contentDir = await makeFixture();
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'glint-out-'));

    const result = await buildSite({ contentDir, outDir });
    assert.equal(result.failures.length, 0, JSON.stringify(result.failures));
    assert.equal(result.pages, 2);

    // Directory-per-page layout
    const home = await fs.readFile(path.join(outDir, 'README', 'index.html'), 'utf8');
    const first = await fs.readFile(path.join(outDir, 'notes', 'first', 'index.html'), 'utf8');
    await fs.access(path.join(outDir, 'index.html')); // baseFile copy

    // Wiki link rewritten to directory-per-page
    assert.match(home, /href="\/notes\/first\/"/);

    // No server-only URLs leak into output
    assert.ok(!first.includes('/api/'), 'no /api/ in output');
    assert.ok(!/href="\/f\//.test(first), 'no /f/ links in output');

    // Image rewritten + asset copied
    assert.match(first, /src="\/notes\/first\.md\.assets\/p\.png"/);
    await fs.access(path.join(outDir, 'notes', 'first.md.assets', 'p.png'));

    // Render path intact (KaTeX) and read-only bundles only
    assert.ok(first.includes('katex'), 'katex output present');
    assert.ok(!first.includes('editor.bundle.js'), 'editor bundle dropped');
    assert.ok(first.includes('outline.bundle.js'), 'outline bundle kept');

    await fs.rm(contentDir, { recursive: true, force: true });
    await fs.rm(outDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails (then passes once code is correct)**

Run: `tsx --test src/tests/build.test.ts`
Expected: PASS if Tasks 1–4 are correct. If it fails, debug against the assertion (most likely the asset-path rewrite or the wiki-link form) — use `systematic-debugging` rather than loosening assertions.

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: all tests pass (including pre-existing ones).

- [ ] **Step 4: Commit**

```bash
git add src/tests/build.test.ts
git commit -m "test(build): integration test for static build"
```

---

## Notes / deferred (not in scope for this plan)

- `--watch` (chokidar rebuild) and `--install-git-hook` (post-commit rebuild) — designed as cheap follow-ons since `buildSite` is a reusable unit.
- Static task dashboard and client-side search — deferred per spec.
- Copying the *whole* `assets/` dir includes the dropped bundles (dead files). Acceptable for v1; prune later if size matters.
- Pre-existing repo-wide TS errors (editor-sessions, task widgets) are unrelated and intentionally untouched.
```

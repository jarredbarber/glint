# Shareable Standalone Pages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `glint build` emit isolated standalone copies of pages marked `share: true` in frontmatter, under a `share/` tree (or a separate `--shared-out` dir), leaking nothing about the rest of the wiki.

**Architecture:** A page with `share: true` is rendered a second time in standalone mode (reusing the existing `isShared` chrome-hiding), its inter-page links stripped to plain text, its images copied in and referenced relatively, and written to `<share-root>/<path-hash-slug>/index.html`. The normal full build is untouched and additive.

**Tech Stack:** TypeScript (ESM, strict), Node `node:crypto` for the HMAC slug, Node's native test runner (`node --test` / `tsx --test`), esbuild client bundles (unchanged here).

---

## File Structure

- `src/share-slug.ts` *(new)* — pure `shareSlug(contentPath)` helper. One responsibility: stable, salted, URL-safe slug from a content path.
- `src/url-rewrite.ts` *(modify)* — add `stripInternalLinks(html)` and `rewriteShareAssets(html, contentPath)`. Pure string transforms, alongside the existing `rewriteStaticHtml` / `applyPrefix`.
- `src/renderer.ts` *(modify)* — add `standalone?: boolean` to `RenderOptions`; `isShared = !!shareId || standalone`; pass `standalone` to the sidebar.
- `src/renderer/sidebar.ts` *(modify)* — accept `standalone?`; render branding logo without the `/` link when standalone.
- `src/build.ts` *(modify)* — `BuildOptions.sharedOut?`; detect `share: true`; emit standalone share pages; copy their assets; for a separate `--shared-out`, copy client `/assets/` in.
- `src/cli.ts` *(modify)* — `--shared-out <dir>` option wired into `buildSite` / `watchSite`.
- `CLAUDE.md` *(modify)* — correct the config-format note (TOML, not JSON).
- Tests: `src/tests/share-slug.test.ts` *(new)*, `src/tests/url-rewrite.test.ts` *(new)*, `src/tests/render-static.test.ts` *(modify)*, `src/tests/build.test.ts` *(modify)*.

Run all tests with: `npm test`. Run one file with: `tsx --test src/tests/<file>.test.ts`.

---

## Task 1: Path-hash slug helper

**Files:**
- Create: `src/share-slug.ts`
- Test: `src/tests/share-slug.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/tests/share-slug.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shareSlug } from '../share-slug.js';

test('shareSlug is deterministic for the same path', () => {
    assert.equal(shareSlug('notes/first.md'), shareSlug('notes/first.md'));
});

test('shareSlug differs across paths', () => {
    assert.notEqual(shareSlug('notes/first.md'), shareSlug('notes/second.md'));
});

test('shareSlug is short and URL-safe (hex)', () => {
    const slug = shareSlug('notes/first.md');
    assert.match(slug, /^[0-9a-f]{12}$/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `tsx --test src/tests/share-slug.test.ts`
Expected: FAIL — cannot find module `../share-slug.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/share-slug.ts
import crypto from 'node:crypto';

// Hardcoded salt: this is obscurity, not security. It only raises the bar above
// "guess the file path", which is enough for a non-sensitive shareable link.
const SHARE_SALT = 'glint-share-v1-7f3a9c';

/**
 * Stable, salted, URL-safe slug for a shared page. Derived from the content
 * PATH (not its bytes) so the share URL does not churn when the page is edited.
 * Salted HMAC so the slug is not computable from the path alone.
 */
export function shareSlug(contentPath: string): string {
    return crypto
        .createHmac('sha256', SHARE_SALT)
        .update(contentPath)
        .digest('hex')
        .slice(0, 12);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `tsx --test src/tests/share-slug.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/share-slug.ts src/tests/share-slug.test.ts
git commit -m "feat(share): stable salted path-hash slug helper"
```

---

## Task 2: `stripInternalLinks` and `rewriteShareAssets` passes

**Files:**
- Modify: `src/url-rewrite.ts`
- Test: `src/tests/url-rewrite.test.ts`

`stripInternalLinks` removes any `<a>` whose href is a root-relative path
(internal page link, e.g. `/notes/second/`) and keeps its inner content. It
leaves anchors (`#…`), external (`http://`, `https://`, protocol-relative
`//…`), and `mailto:`/`tel:` links untouched. Anchors do not nest, so a
non-greedy inner match is safe.

`rewriteShareAssets` turns the absolute image URL `rewriteStaticHtml` produces
(`/{dir}/{base}.md.assets/…`) into the page-relative `{base}.md.assets/…` so the
share dir is self-contained.

- [ ] **Step 1: Write the failing test**

```typescript
// src/tests/url-rewrite.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripInternalLinks, rewriteShareAssets } from '../url-rewrite.js';

test('strips internal page links to plain text', () => {
    const html = 'see <a href="/notes/second/">Second</a> page';
    assert.equal(stripInternalLinks(html), 'see Second page');
});

test('keeps external, anchor, and mailto links', () => {
    const html =
        '<a href="https://x.com">x</a> ' +
        '<a href="#sec">sec</a> ' +
        '<a href="//cdn.com/a">cdn</a> ' +
        '<a href="mailto:a@b.com">mail</a>';
    assert.equal(stripInternalLinks(html), html);
});

test('strips internal link that has extra attributes, keeps inner markup', () => {
    const html = '<a class="x" href="/a/b/" data-y="1">go <em>now</em></a>';
    assert.equal(stripInternalLinks(html), 'go <em>now</em>');
});

test('rewriteShareAssets makes md.assets URLs relative to the page', () => {
    const html = '<img src="/notes/first.md.assets/p.png">';
    assert.equal(
        rewriteShareAssets(html, 'notes/first.md'),
        '<img src="first.md.assets/p.png">'
    );
});

test('rewriteShareAssets handles a root-level page (no dir)', () => {
    const html = '<img src="/first.md.assets/p.png">';
    assert.equal(
        rewriteShareAssets(html, 'first.md'),
        '<img src="first.md.assets/p.png">'
    );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `tsx --test src/tests/url-rewrite.test.ts`
Expected: FAIL — `stripInternalLinks` / `rewriteShareAssets` are not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/url-rewrite.ts`:

```typescript
/**
 * Removes every <a> whose href is a root-relative internal page link
 * (e.g. "/notes/second/"), leaving its inner content in place. Used only on
 * standalone share pages so they cannot link back into the wiki. Keeps
 * anchors (#…), external (http/https), protocol-relative (//…), and
 * mailto:/tel: links. Anchors never nest, so the non-greedy inner match is safe.
 */
export function stripInternalLinks(html: string): string {
    // href="/x" but NOT href="//x" (protocol-relative).
    return html.replace(
        /<a\b[^>]*\bhref="\/(?!\/)[^"]*"[^>]*>([\s\S]*?)<\/a>/g,
        (_full, inner: string) => inner
    );
}

/**
 * Rewrites a shared page's own image URLs from the absolute form produced by
 * rewriteStaticHtml ("/{dir}/{base}.md.assets/…") to the page-relative form
 * ("{base}.md.assets/…"), so the emitted <share-root>/<slug>/ directory is
 * self-contained and reveals no wiki path. contentPath is the page's source
 * path, e.g. "notes/first.md".
 */
export function rewriteShareAssets(html: string, contentPath: string): string {
    const base = path.posix.basename(contentPath, '.md');
    const dir = path.posix.dirname(contentPath); // "." for root-level files
    const absPrefix = dir === '.' ? `/${base}.md.assets/` : `/${dir}/${base}.md.assets/`;
    const relPrefix = `${base}.md.assets/`;
    // Replace inside href="…" or src="…" attribute values only.
    return html.split(`"${absPrefix}`).join(`"${relPrefix}`);
}
```

(`path` is already imported at the top of `src/url-rewrite.ts`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `tsx --test src/tests/url-rewrite.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/url-rewrite.ts src/tests/url-rewrite.test.ts
git commit -m "feat(share): stripInternalLinks + rewriteShareAssets passes"
```

---

## Task 3: `standalone` render flag

**Files:**
- Modify: `src/renderer.ts:13-29` (RenderOptions + destructure), `src/renderer.ts:94` (sidebar call)
- Modify: `src/renderer/sidebar.ts:5-16` (options + branding)
- Test: `src/tests/render-static.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/tests/render-static.test.ts` (it already imports `renderHtml` and builds a minimal `RenderOptions`; mirror that existing setup — reuse its `config`/`fileTree` fixtures):

```typescript
test('standalone render hides file tree and the home branding link', () => {
    const out = renderHtml({
        content: '<p>hi</p>',
        title: 'Shared',
        config,            // reuse the fixture already defined in this file
        fileTree,          // reuse the fixture already defined in this file
        currentPath: 'notes/first.md',
        static: true,
        standalone: true,
    });
    assert.ok(!out.includes('class="file-tree"'), 'no file tree in standalone');
    assert.ok(!out.includes('<a href="/"'), 'no home branding link in standalone');
});
```

If `config`/`fileTree` fixtures are not already in scope in this file, define minimal ones at the top of the test: `const config = { theme: 'nord' } as any;` and `const fileTree = [] as any;`.

- [ ] **Step 2: Run test to verify it fails**

Run: `tsx --test src/tests/render-static.test.ts`
Expected: FAIL — `standalone` is not a valid option / home link still present.

- [ ] **Step 3: Implement the flag**

In `src/renderer.ts`, add `standalone?: boolean;` to the `RenderOptions` interface (after `static?: boolean;`):

```typescript
    static?: boolean;
    standalone?: boolean;
```

Update the destructure on line 29 to include `standalone` and fold it into `isShared`:

```typescript
    const { content, title, config, fileTree, currentPath, headings = [], frontmatter = {}, access, shareId, scripts = [], styles = [], static: isStatic = false, standalone = false } = options;
    const isShared = !!shareId || standalone;
```

Update the sidebar call (line 94) to pass `standalone`:

```typescript
    ${renderSidebar({ fileTree, currentPath, headings, currentTheme: config.theme, isShared, static: isStatic, standalone })}
```

In `src/renderer/sidebar.ts`, add `standalone?: boolean;` to `SidebarOptions`, destructure it (default `false`), and make the branding logo non-linking when standalone. Replace the branding block:

```typescript
        <div class="sidebar-branding">
            <a href="/">
                <img src="/assets/logo.png" alt="glint" class="sidebar-logo">
            </a>
        </div>
```

with:

```typescript
        <div class="sidebar-branding">
            ${standalone
                ? `<img src="/assets/logo.png" alt="glint" class="sidebar-logo">`
                : `<a href="/"><img src="/assets/logo.png" alt="glint" class="sidebar-logo"></a>`}
        </div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `tsx --test src/tests/render-static.test.ts`
Expected: PASS (existing tests + the new one).

- [ ] **Step 5: Commit**

```bash
git add src/renderer.ts src/renderer/sidebar.ts src/tests/render-static.test.ts
git commit -m "feat(share): standalone render flag (no tree, no home link)"
```

---

## Task 4: Emit share pages in the build

**Files:**
- Modify: `src/build.ts` — `BuildOptions` (after line 25), the per-page loop (after line 144, inside the `try`), and add an `emitSharePage` helper.
- Test: `src/tests/build.test.ts`

This task emits shares into the **default** location (`<outDir>/share/`). The separate `--shared-out` directory and its self-contained `/assets/` copy come in Task 5.

- [ ] **Step 1: Write the failing test**

Add to `src/tests/build.test.ts`. The existing fixture (lines ~14-18) writes `notes/first.md` with an image. Add a second page marked shared, then assert on the emitted share dir. Use `shareSlug` to compute the expected path:

```typescript
import { shareSlug } from '../share-slug.js';

test('emits a standalone share page with stripped links and relative assets', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'glint-share-'));
    await fs.mkdir(path.join(dir, 'notes', 'first.md.assets'), { recursive: true });
    await fs.writeFile(path.join(dir, 'notes', 'first.md.assets', 'p.png'), 'PNGDATA');
    await fs.writeFile(
        path.join(dir, 'notes', 'first.md'),
        '---\nshare: true\n---\n# First\n\n![pic](first.md.assets/p.png)\n\nlink to [Second](second.md)\n'
    );
    await fs.writeFile(path.join(dir, 'notes', 'second.md'), '# Second\n');

    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'glint-out-'));
    await buildSite({ contentDir: dir, outDir });

    const slug = shareSlug('notes/first.md');
    const shareHtml = await fs.readFile(
        path.join(outDir, 'share', slug, 'index.html'),
        'utf8'
    );
    // standalone chrome
    assert.ok(!shareHtml.includes('class="file-tree"'), 'no file tree');
    // internal link stripped to plain text
    assert.ok(!shareHtml.includes('href="/notes/second/"'), 'internal link stripped');
    assert.ok(shareHtml.includes('Second'), 'link text kept');
    // image is relative and copied in
    assert.ok(shareHtml.includes('src="first.md.assets/p.png"'), 'relative asset');
    await fs.access(path.join(outDir, 'share', slug, 'first.md.assets', 'p.png'));
});

test('does not emit a share page for an unshared file', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'glint-noshare-'));
    await fs.writeFile(path.join(dir, 'plain.md'), '# Plain\n');
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'glint-out-'));
    await buildSite({ contentDir: dir, outDir });
    await assert.rejects(fs.access(path.join(outDir, 'share')));
});
```

(`os` is already imported in this test file; if not, add `import os from 'node:os';`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `tsx --test src/tests/build.test.ts`
Expected: FAIL — `<outDir>/share/<slug>/index.html` does not exist.

- [ ] **Step 3: Implement share emission**

In `src/build.ts`, extend the imports at the top:

```typescript
import { rewriteStaticHtml, applyPrefix, applyKatexCdn, stripInternalLinks, rewriteShareAssets } from './url-rewrite.js';
import { shareSlug } from './share-slug.js';
```

Add to `BuildOptions` (after `katexCdn?: boolean;`):

```typescript
    /** Separate output dir for share pages. Defaults to `<outDir>/share`. */
    sharedOut?: string;
```

Add a helper above `buildSite`:

```typescript
/**
 * Render and write a single standalone share page plus its image assets.
 * Mirrors the normal render transforms, then strips internal links and makes
 * the page's own assets relative so the emitted <slug>/ dir is self-contained.
 */
async function emitSharePage(
    opts: BuildOptions,
    shareRoot: string,
    contentPath: string,
    renderArgs: Parameters<typeof renderer.renderHtml>[0],
    storage: StorageManager,
    katexVersion: string,
    onCopied: () => void
): Promise<void> {
    const slug = shareSlug(contentPath);

    let html = renderer.renderHtml({ ...renderArgs, static: true, standalone: true });
    html = rewriteStaticHtml(html);
    html = stripInternalLinks(html);
    html = rewriteShareAssets(html, contentPath);
    if (opts.katexCdn) html = applyKatexCdn(html, katexVersion);
    if (opts.prefix) html = applyPrefix(html, opts.prefix);

    await writeFile(path.join(shareRoot, slug, 'index.html'), html);

    // Copy this page's assets into the slug dir, mirroring its {base}.md.assets name.
    const assetsRel = `${contentPath}.assets`;
    if (await storage.exists(assetsRel)) {
        const base = path.posix.basename(contentPath); // e.g. "first.md"
        await copyShareAssets(storage, assetsRel, path.join(shareRoot, slug, `${base}.assets`), onCopied);
    }
}

/** Copy a storage dir tree into an absolute destination dir. */
async function copyShareAssets(
    storage: StorageManager,
    relDir: string,
    destDir: string,
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
            await copyShareAssets(storage, childRel, path.join(destDir, entry.name), onCopied);
        } else {
            const buf = await storage.readBuffer(childRel);
            await writeFile(path.join(destDir, entry.name), buf);
            onCopied();
        }
    }
}
```

Note on the asset dir name: `${contentPath}.assets` where `contentPath` ends in `.md` gives `first.md.assets`, and `path.posix.basename(contentPath)` is `first.md`, so the dest dir is `first.md.assets` — matching the relative URL `first.md.assets/p.png` that `rewriteShareAssets` produces.

In `buildSite`, compute the share root once, before the loop (after the out-dir guard / clean, e.g. after line 110):

```typescript
    const shareRoot = opts.sharedOut ? path.resolve(opts.sharedOut) : path.join(opts.outDir, 'share');
```

Inside the per-page `try`, after the normal page is written and its assets copied (after line 150), add:

```typescript
            if (frontmatter.share === true) {
                await emitSharePage(
                    opts,
                    shareRoot,
                    contentPath,
                    { content: String(vfile), title, config, fileTree, currentPath: contentPath, headings, frontmatter },
                    storage,
                    katexVersion,
                    () => result.assetsCopied++
                );
            }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `tsx --test src/tests/build.test.ts`
Expected: PASS (existing build tests + the two new ones).

- [ ] **Step 5: Commit**

```bash
git add src/build.ts src/tests/build.test.ts
git commit -m "feat(share): emit standalone share pages during build"
```

---

## Task 5: `--shared-out` separate, self-contained directory

**Files:**
- Modify: `src/build.ts` — guard `sharedOut`; when it is a separate dir, copy client `/assets/` into it.
- Modify: `src/cli.ts:51-57,95,102` — add the option and thread it through.
- Test: `src/tests/build.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
test('--shared-out emits shares to a separate, self-contained dir', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'glint-so-content-'));
    await fs.writeFile(
        path.join(dir, 'doc.md'),
        '---\nshare: true\n---\n# Doc\n\n$x^2$\n'
    );
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'glint-so-out-'));
    const sharedOut = await fs.mkdtemp(path.join(os.tmpdir(), 'glint-so-share-'));

    await buildSite({ contentDir: dir, outDir, sharedOut });

    const slug = shareSlug('doc.md');
    // share page lives directly under sharedOut/<slug>/, not under sharedOut/share/
    await fs.access(path.join(sharedOut, slug, 'index.html'));
    // self-contained: client assets + katex copied into sharedOut/assets
    await fs.access(path.join(sharedOut, 'assets', 'katex', 'katex.min.css'));
    // and NOT under the main outDir/share
    await assert.rejects(fs.access(path.join(outDir, 'share')));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `tsx --test src/tests/build.test.ts`
Expected: FAIL — `sharedOut/assets/katex/...` missing (assets not copied to the separate dir).

- [ ] **Step 3: Implement separate-dir handling**

In `buildSite`, after computing `shareRoot`, detect whether it is a separate location (not inside `outDir`):

```typescript
    const resolvedShareRoot = path.resolve(shareRoot);
    const shareRootIsSeparate =
        !!opts.sharedOut &&
        resolvedShareRoot !== resolvedOut &&
        !(resolvedShareRoot + path.sep).startsWith(resolvedOut + path.sep);
```

Add a guard next to the existing out-dir guard so we never wipe/write something dangerous (the share root is only created, never `rm`-ed, but still refuse the obvious footguns):

```typescript
    if (shareRootIsSeparate) {
        const sroot = path.parse(resolvedShareRoot).root;
        if (resolvedShareRoot === sroot || resolvedShareRoot === os.homedir() || resolvedShareRoot === resolvedContent) {
            throw new Error(`Refusing to use "${resolvedShareRoot}" as --shared-out: it is the filesystem root, your home directory, or the content directory.`);
        }
    }
```

At the end of `buildSite`, after the existing client-assets copy and `inlineKatexFonts` block (after line 164), make a separate share root self-contained:

```typescript
    if (shareRootIsSeparate) {
        await fs.cp(repoAssets, path.join(resolvedShareRoot, 'assets'), { recursive: true });
        if (opts.inlineFonts) {
            await inlineKatexFonts(path.join(resolvedShareRoot, 'assets', 'katex'));
        }
    }
```

(`repoAssets` is already defined just above for the main copy; reuse it.)

In `src/cli.ts`, add the option after `--katex-cdn` (line 55):

```typescript
    .option('--shared-out <dir>', 'Emit share pages to a separate, self-contained directory')
```

Add `sharedOut?: string` to the `options` type on line 57, log it if present (near line 74):

```typescript
        if (options.sharedOut) console.log(`  shares:  ${path.resolve(options.sharedOut)}`);
```

and pass it through both call sites (lines 95 and 102) by adding `sharedOut: options.sharedOut` to the options object:

```typescript
        const stop = await watchSite({ contentDir, outDir, configPath, prefix: options.prefix, inlineFonts: options.inlineFonts, katexCdn: options.katexCdn, sharedOut: options.sharedOut }, console.log, onRebuild);
```

```typescript
        const result = await buildSite({ contentDir, outDir, configPath, prefix: options.prefix, inlineFonts: options.inlineFonts, katexCdn: options.katexCdn, sharedOut: options.sharedOut });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `tsx --test src/tests/build.test.ts`
Expected: PASS (all build tests including the new `--shared-out` one).

- [ ] **Step 5: Typecheck and full test run**

Run: `npm run build && npm test`
Expected: TypeScript compiles clean; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/build.ts src/cli.ts src/tests/build.test.ts
git commit -m "feat(share): --shared-out separate self-contained share dir"
```

---

## Task 6: Fix the stale config-format note in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Correct the config format**

In `CLAUDE.md`, the Tech Stack line reads:

```
- **Config:** Zod schema validation, stored in `.glint/config.json`
```

Glint actually uses TOML (`glint.toml` or `.glint/config.toml`, parsed by `smol-toml`). Replace with:

```
- **Config:** Zod schema validation over TOML (`glint.toml` or `.glint/config.toml`, parsed by `smol-toml`)
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: correct config format note (TOML, not JSON)"
```

---

## Self-Review notes

- **Spec coverage:** frontmatter `share: true` (Task 4); path-hash salted slug (Task 1); standalone render reusing `isShared` + branding fix (Task 3); strip internal links (Task 2 + wired in Task 4); relative self-contained assets (Tasks 2 + 4); `--shared-out` separate self-contained dir (Task 5); CLAUDE.md fix (Task 6). All spec sections map to a task.
- **Tolerant `share`:** only the strict `frontmatter.share === true` triggers a share; any other value is ignored and never crashes the build (spec "Open questions").
- **Names are consistent across tasks:** `shareSlug`, `stripInternalLinks`, `rewriteShareAssets`, `standalone`, `sharedOut`, `shareRoot`, `emitSharePage`, `copyShareAssets`.
- **No closure / no rich frontmatter:** intentionally absent, per spec non-goals.

# Static Build (`glint build`) — Design

## Goal

Add a `glint build` command that emits a fully static, self-contained snapshot of
a Glint wiki — HTML files that render correctly on a dumb file host (S3, GitHub
Pages, nginx) with **no Node process behind them**. This is an *addon*: the
existing `glint serve` server, its routes, and all live-editing features are
untouched. The static artifact is read-only.

This is exploratory. If the static workflow proves useful, the rendering core may
later be ported to a greenfield project (possibly 11ty). This spec covers only the
build addon against the current codebase.

## Non-goals (v1)

- Editing, comments, uploads, share links, SSE hot-reload — dropped from the
  artifact by design.
- No `/api/*` (no server to answer it).
- No static task dashboard, no client-side search. (Deferred; revisit if useful.)
- No auth in the artifact. Auth, if needed, is added at the host/proxy layer
  (Cloudflare Access, oauth2-proxy, etc.) — out of scope here.

## Decisions

| Decision | Choice |
|----------|--------|
| URL scheme | **Directory-per-page**: `foo/bar.md` → `dist/foo/bar/index.html`, served at `/foo/bar/`. Clean extensionless URLs, works on any host, no `.html` suffix. |
| Client JS | **Read-only set + Mermaid.** Keep: outline, lightbox, code-blocks, mobile-sidebar, citations, router. Drop: editor, editor-integration, upload, share, command-palette, image-resize. Keep the Mermaid CDN script (diagrams render client-side). |
| CLI | `glint build [path] --out dist` (new commander subcommand; default out `./dist`). |
| Base page | `config.baseFile` → `dist/index.html`. |

## Architecture

The render path is already pure: `parseMarkdown → processor.process →
renderer.renderHtml` depends only on (file content, file path, file tree) — no
request state. The build reuses it directly.

```
src/build.ts          NEW — orchestrates the build
src/cli.ts            +build subcommand
src/renderer.ts       +`static?: boolean` on RenderOptions → forwarded to renderScripts
src/renderer/scripts.ts  branch on static flag → emit read-only bundle set only
src/url-rewrite.ts    NEW — rewrite emitted HTML links to directory-per-page scheme
```

### Build flow (`src/build.ts`)

1. Load config (`.glint/config.json`) for the content dir, same as `serve`.
2. Build the file tree once via `buildFileTree` (reused for every page's sidebar).
3. Enumerate all `.md` files under the content dir.
4. For each file:
   a. `parseMarkdown` → clean content + `contentStartLine` + frontmatter + title.
   b. Run the shared `processor` (the existing unified pipeline) → HTML + headings.
   c. `renderer.renderHtml({ ..., static: true, access: 'read' })`.
   d. Rewrite links in the output HTML (see URL rewriting).
   e. Write to `dist/<path-without-.md>/index.html`.
   f. Copy the sibling `<file>.md.assets/` folder, if present, alongside the page.
5. Write `config.baseFile` output as `dist/index.html`.
6. Copy the kept client bundles + global styles + any static assets into
   `dist/assets/`.
7. Print a summary (pages written, assets copied, output path).

The processor is currently assembled inline in `server.ts`. For v1, `build.ts`
constructs the **same** processor (extract a small shared factory if the inline
assembly can be lifted without disturbing `serve`; otherwise duplicate the chain
with a TODO to factor it out). The pipeline ordering documented in CLAUDE.md must
be preserved exactly.

### URL rewriting (`src/url-rewrite.ts`)

The server emits absolute app links (`/f/foo/bar.md`, `/f/foo/bar`, wiki-link
output `/f/foo/bar.md`, image `src`, heading anchors). For directory-per-page the
static output needs:

- `/f/foo/bar.md` and `/f/foo/bar` → `/foo/bar/`
- root/base links → `/`
- `.md.assets/` image srcs → relative path that resolves from the page's
  directory (`/foo/bar/bar.md.assets/img.png`).
- In-page heading anchors (`#L12`, slug anchors) → left as-is.

Implemented as a single post-render pass over the HTML string (one rewrite
function with a documented mapping), **not** threaded through every plugin. This
keeps "static mode" knowledge in one place. Mermaid blocks, KaTeX, and code
highlighting are already static HTML and need no rewriting.

### Read-only script set (`src/renderer/scripts.ts`)

`renderScripts` gains a `static` branch. When static:

- Emit only: `router`, `outline`, `citations`, `lightbox`, `code-blocks`,
  `mobile-sidebar` bundles.
- Omit: `upload`, `editor`, `editor-integration`, `share`, `command-palette`,
  `image-resize`.
- Keep the inline anchor-copy script and the Mermaid CDN `<script>` (in `head.ts`).
- Body `data-access` is set to a read-only value so any surviving client code that
  checks `canEdit()`/`canComment()` no-ops. The line-tracker / edit affordances
  live in dropped bundles, so they simply never load.

`router` is kept for client-side nav between static pages; it must tolerate the
absence of `/api/*` (verify it degrades to full-page navigation — see Risks).

## Auto-rebuild (follow-on, not blocking v1)

The build is a single callable function (`buildSite(opts)`), so two triggers come
cheaply once it exists:

- **File-change watch:** reuse the existing chokidar watcher (already in the repo)
  → debounce → `buildSite`. Could be a `--watch` flag on `glint build`.
- **Local git commit:** a `.git/hooks/post-commit` (and `post-merge`) one-liner
  running `glint build`. No push/CI needed. `glint build --install-git-hook` could
  scaffold it.

These are out of scope for the first PR but the design keeps `buildSite` as a
clean reusable unit so they drop in later.

## Error handling

- Missing/invalid config → clear error, non-zero exit.
- A file that fails to render → log the path + error, **skip it, continue**, and
  include it in a final "N pages failed" summary with non-zero exit. One bad file
  must not abort the whole build.
- `--out` directory: created if absent; existing contents cleaned (or `--clean`
  flag) — confirm behavior in plan to avoid nuking an unrelated dir.

## Testing

- **Unit:** `url-rewrite` mapping — table of input link → expected output for each
  case (file link, bare `/f/`, asset src, base, anchor passthrough).
- **Unit:** `renderScripts({static:true})` emits the kept set and none of the
  dropped set.
- **Integration:** build a small fixture wiki (a few `.md`, one with an asset, one
  with a wiki-link, one with mermaid/math) into a temp dir; assert:
  - expected `index.html` files exist at directory-per-page paths,
  - links rewritten correctly,
  - assets copied,
  - no dropped bundle referenced, no `/api/` or `/f/` string in output,
  - KaTeX/highlight HTML present (render path intact).

Uses the existing Node native test runner (`tsx --test`).

## Open question deferred to plan

How cleanly the inline processor in `server.ts` can be lifted into a shared
factory both `serve` and `build` import (vs. temporary duplication). The plan
should scope this explicitly — it's the one real coupling risk.

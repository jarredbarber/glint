# Shareable Standalone Pages (static build) — Design

**Date:** 2026-06-10
**Status:** Approved, ready for planning

## Problem

`glint build` emits a full static site: directory-per-page HTML with a sidebar
file tree (the whole wiki structure), inter-page wiki links, and co-located
assets. There is no way to hand someone a single page without exposing the
entire wiki's structure and contents.

We want a **shareable standalone page**: pick individual pages, and have the
build emit isolated copies that reveal nothing about the rest of the wiki — no
sidebar, no file tree, no links that leak the existence of other pages. These
copies live at predictable, ACL-able paths.

## Goals

- Mark individual pages as shareable via a single frontmatter boolean.
- Emit a standalone copy of each shared page under a dedicated, isolated
  `share/` subtree.
- Optionally redirect the share subtree to a **separate output directory** via
  `glint build --shared-out <dir>`, so the full wiki can be published to a
  private host while shares go to an independently published location. A
  separate `--shared-out` dir is made self-contained (gets its own copy of the
  client `/assets/` bundles + KaTeX).
- Shared pages leak nothing about the wiki structure or other pages' paths
  (including via asset URLs — a shared page's images are copied in and
  referenced relatively).
- Share URLs are stable across content edits and not trivially guessable.
- The normal full build is unchanged — the share tree is purely additive.

## Non-goals (YAGNI / explicitly cut)

- **No closure / transitive sharing.** Sharing a page shares only that page.
  Cross-page links degrade to plain text (see below). Closure — and the
  "rewrite link to another shared page" machinery it would justify — can be
  bolted on later if dead links between co-shared pages ever become an actual
  annoyance. Do not build it speculatively.
- **No rich `share` frontmatter block.** No explicit `slug`, no `enabled`, no
  `closure`, no title override, no expiry. Just `share: true`.
- No real access control / auth. Static output cannot enforce it; hosting-level
  ACLs (a "useful quirk") can be pointed at the share paths by the user.
- No `[share]` config section in `glint.toml`. The only knob is the
  `--shared-out` CLI flag.
- No single-file (`.html` data-URI) export. Possible future extension; out of
  scope here.

## Sharing model (Section 1)

Sharing is declared **per page in frontmatter only**, as a single boolean. No
site config required.

```yaml
share: true
```

- **Slug:** always `base32(hmac(SALT, contentPath)).slice(0, 10)`.
  - `SALT` is a hardcoded constant in the build code. This is not a
    high-security product; the salt only raises the bar above "guess the path."
  - Derived from the **content path**, not content bytes → stable across edits
    (a content hash would churn the URL on every save).
  - Salted HMAC → not computable from the path alone.
- **Output location (share root):**
  - Default: `<outDir>/share/`. Shares ride along inside the normal build and
    reuse its sibling `/assets/` bundles (referenced absolutely).
  - With `--shared-out <dir>`: `<dir>/` directly (one `<slug>/` dir per share).
    Because this dir is meant to be published on its own, it is made
    self-contained: the client `/assets/` bundle dir (plus KaTeX, honoring
    `--inline-fonts` / `--katex-cdn`) is copied into `<dir>/assets/`.
  - Either way, each share is emitted at `<share-root>/<slug>/index.html`.

## Build flow & standalone rendering (Section 2)

Implemented inside `buildSite` (`src/build.ts`):

In the existing per-page loop, after emitting the normal page, check
`frontmatter.share === true`. If set, also render a **standalone** variant and
emit it to `<share-root>/<slug>/index.html`. No separate pre-scan is needed —
each share is independent (no closure), so it can be produced inline alongside
the normal page. The normal full build still emits every page (including shared
ones) at its usual in-tree path with sidebar — unchanged. The share tree is
additive.

**Standalone rendering** reuses the existing `static: true` renderer. The
existing `isShared` rendering mode (driven today by server share links via
`shareId`) already hides the file tree, breadcrumbs, Views section, vim/share
buttons, and makes theme switching client-only. We add a `standalone?: boolean`
to `RenderOptions` and compute `isShared = !!shareId || standalone`, so the
share build gets all of that without setting a bogus `shareId`. The one extra
change: the sidebar branding logo links to `/` (home); in `standalone` mode it
renders without that link so nothing points back into the wiki. Math (KaTeX),
code highlighting, and images are kept.

`standalone: true` is applied **automatically** for every share page. It is not
a user-facing flag.

## Link rewriting inside a standalone page (Section 3)

A new HTML pass applied **only** to share pages, running **after** the existing
`rewriteStaticHtml` (so it sees resolved page URLs, not `/f/...`). For each
`href` pointing at another content page:

- **Strip the `<a>` element, leaving its text content in place.** Every
  inter-page link becomes plain text — no href, no leak. There is no
  "is the target also shared?" lookup (that's the closure feature we cut).
- **External / anchor / mailto** → untouched.

## Assets (Section 4)

For each shared page, copy its `{base}.md.assets/` directory into
`<share-root>/<slug>/{base}.md.assets/` and rewrite the page's image URLs from
the absolute `/{dir}/{base}.md.assets/...` (produced by `rewriteStaticHtml`) to
the **relative** `{base}.md.assets/...`. This both isolates the share (no
absolute path back into the wiki tree) and keeps each `<slug>/` directory
self-contained.

Client bundles under `/assets/` (KaTeX CSS/fonts, JS) are referenced
absolutely. In the default (in-`outDir`) case they resolve to the build's own
`/assets/`. With `--shared-out`, a copy is placed at `<share-root>/assets/` so
the separate dir resolves them too. They are not wiki content, so they leak
nothing.

## Files likely touched

- `src/build.ts` — `BuildOptions.sharedOut`, share detection in the loop,
  path-hash slug, standalone render + emit, share-asset rewrite/copy, and (for
  `--shared-out`) self-contained `/assets/` copy.
- `src/url-rewrite.ts` — new `stripInternalLinks` pass and `rewriteShareAssets`
  helper (absolute `.md.assets` URL → relative). Plus the path-hash slug helper
  (or a small new `src/share-slug.ts`).
- `src/renderer.ts` — add `standalone?: boolean` to `RenderOptions`; compute
  `isShared = !!shareId || standalone`; thread `standalone` to the sidebar.
- `src/renderer/sidebar.ts` — drop the branding home link when `standalone`.
- `src/cli.ts` — add `--shared-out <dir>` option, pass to `buildSite` /
  `watchSite`.
- Tests: `src/tests/build.test.ts`, `src/tests/render-static.test.ts`,
  `src/tests/url-rewrite.test.ts` (create if absent).

Frontmatter already surfaces arbitrary keys via `parseMarkdown` →
`frontmatter`, so `frontmatter.share` is available with no parser change.

## Housekeeping

- **Fix CLAUDE.md:** it states config is JSON in `.glint/config.json`. Actual
  format is **TOML** (`glint.toml` or `.glint/config.toml`, parsed by
  `smol-toml`). Correct this while in here.

## Open questions / risks

- Frontmatter `share` should be tolerant of a malformed value (e.g. a non-bool):
  treat anything other than `true` as "not shared," and don't crash the build.
  A truthy-but-wrong value silently not sharing is acceptable for a boolean this
  simple — no zod schema needed.

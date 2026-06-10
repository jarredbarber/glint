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
  `/share/` subtree.
- Shared pages leak nothing about the wiki structure.
- Share URLs are stable across content edits and not trivially guessable.
- The normal full build is unchanged — the `/share/` tree is purely additive.

## Non-goals (YAGNI / explicitly cut)

- **No closure / transitive sharing.** Sharing a page shares only that page.
  Cross-page links degrade to plain text (see below). Closure — and the
  "rewrite link to another shared page" machinery it would justify — can be
  bolted on later if dead links between co-shared pages ever become an actual
  annoyance. Do not build it speculatively.
- **No rich `share` frontmatter block.** No explicit `slug`, no `enabled`, no
  `closure`, no title override, no expiry. Just `share: true`.
- No real access control / auth. Static output cannot enforce it; hosting-level
  ACLs (a "useful quirk") can be pointed at `/share/` paths by the user.
- No configurable output base path / no `[share]` config section in
  `glint.toml`.
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
- **Output subtree:** hardcoded `/share/`.

## Build flow & standalone rendering (Section 2)

Implemented inside `buildSite` (`src/build.ts`):

1. After collecting `mdPaths`, parse each page's frontmatter and check for
   `share: true`. Build a **share set**: `Set<contentPath>`.
2. For each page in the share set, render a **standalone** variant and emit to
   `/share/<slug>/index.html`.
3. The normal full build still emits every page (including shared ones) at its
   usual in-tree path with sidebar — unchanged. `/share/` is additive.

**Standalone rendering** reuses the existing `static: true` renderer plus a new
`standalone: true` flag that:

- omits the sidebar / file tree entirely,
- drops home/breadcrumb nav that points back into the wiki,
- keeps theme switcher, math (KaTeX), code highlighting, and images.

`standalone: true` is applied **automatically** to every page emitted into
`/share/`. It is not a user-facing flag; it is simply how the share renderer is
invoked. The in-tree copy is rendered normally.

## Link rewriting inside a standalone page (Section 3)

A new HTML pass applied **only** to `/share/` pages, running **after** the
existing `rewriteStaticHtml` (so it sees resolved page URLs, not `/f/...`). For
each `href` pointing at another content page:

- **Strip the `<a>` element, leaving its text content in place.** Every
  inter-page link becomes plain text — no href, no leak. There is no
  "is the target also shared?" lookup (that's the closure feature we cut).
- **External / anchor / mailto** → untouched.

## Assets (Section 4)

For each shared page, copy its `{page}.md.assets/` directory into
`/share/<slug>/assets/` and rewrite the page's asset URLs to point there
(relative). Each `/share/<slug>/` directory is therefore self-contained: it can
be ACL'd, or even copied out on its own, and still render.

Shared client bundles under `/assets/` (KaTeX CSS/fonts, JS) stay where they
are and are referenced absolutely. They are not wiki content, so they leak
nothing.

## Files likely touched

- `src/build.ts` — share-set collection (scan for `share: true`), standalone
  emit, asset copy into share tree, path-hash slug.
- `src/url-rewrite.ts` — new strip-internal-links pass for standalone pages.
- `src/renderer.ts` / `src/renderer/*` — `standalone` flag wiring (suppress
  sidebar/nav).
- `src/markdown.ts` / frontmatter parsing — surface the `share` boolean.
- Tests: `src/tests/build.test.ts`, `src/tests/render-static.test.ts`.

## Housekeeping

- **Fix CLAUDE.md:** it states config is JSON in `.glint/config.json`. Actual
  format is **TOML** (`glint.toml` or `.glint/config.toml`, parsed by
  `smol-toml`). Correct this while in here.

## Open questions / risks

- Frontmatter `share` should be tolerant of a malformed value (e.g. a non-bool):
  treat anything other than `true` as "not shared," and don't crash the build.
  A truthy-but-wrong value silently not sharing is acceptable for a boolean this
  simple — no zod schema needed.

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
sidebar, no file tree, no links that leak the existence of unshared pages. These
copies live at predictable, ACL-able paths.

## Goals

- Mark individual pages as shareable via frontmatter.
- Emit a standalone copy of each shared page under a dedicated, isolated
  `/share/` subtree.
- Shared pages leak nothing about the wiki structure.
- Share URLs are stable across content edits and not trivially guessable.
- The normal full build is unchanged — the `/share/` tree is purely additive.

## Non-goals (YAGNI / explicitly cut)

- No real access control / auth. Static output cannot enforce it; hosting-level
  ACLs (a "useful quirk") can be pointed at `/share/` paths by the user.
- No per-page title override, no expiry, no configurable base path.
- No single-file (`.html` data-URI) export. Possible future extension; out of
  scope here.
- No `[share]` config section in `glint.toml`.

## Sharing model (Section 1)

Sharing is declared **per page in frontmatter only**. No site config required.

```yaml
share: true                    # shorthand for { enabled: true }
# — or —
share:
  enabled: true
  slug: q3-roadmap             # optional; omitted → hash(path)
  closure: false               # optional; true = also share linked pages
```

- **Salt:** a hardcoded constant in the build code. This is not a
  high-security product; the salt only raises the bar above "guess the path."
- **Output subtree:** hardcoded `/share/`.
- **Slug resolution:** `share.slug` if present, else
  `base32(hmac(SALT, contentPath)).slice(0, 10)`.
  - Derived from the **content path**, not content bytes → stable across edits
    (a content hash would churn the URL on every save).
  - Salted HMAC → not computable from the path alone.

## Build flow & standalone rendering (Section 2)

Implemented inside `buildSite` (`src/build.ts`):

1. After collecting `mdPaths`, parse each page's frontmatter and scan for
   `share`. Build a **share set**: `Map<contentPath, { slug, closure }>`.
2. For any page with `closure: true`, walk its outbound wiki/relative links
   transitively (cycle-guarded) and add each reachable content page to the share
   set. Closure-added pages get their own path-hash slug.
3. For each page in the share set, render a **standalone** variant and emit to
   `/share/<slug>/index.html`.
4. The normal full build still emits every page (including shared ones) at its
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

- **Target is in the share set** → rewrite to `/share/<target-slug>/`
  (relative, so the whole `/share/` tree is portable as a unit).
- **Target is NOT shared** → strip the `<a>` element, leaving its text content
  in place. No href, no leak.
- **External / anchor / mailto** → untouched.

With `closure: true`, the closure walk guarantees linked targets are in the
share set, so they rewrite to working `/share/` links rather than being
stripped. Without closure, cross-page links degrade to plain text.

## Assets (Section 4)

For each shared page, copy its `{page}.md.assets/` directory into
`/share/<slug>/assets/` and rewrite the page's asset URLs to point there
(relative). Each `/share/<slug>/` directory is therefore self-contained: it can
be ACL'd, or even copied out on its own, and still render.

Shared client bundles under `/assets/` (KaTeX CSS/fonts, JS) stay where they
are and are referenced absolutely. They are not wiki content, so they leak
nothing.

## Files likely touched

- `src/build.ts` — share-set collection, closure walk, standalone emit, asset
  copy into share tree.
- `src/url-rewrite.ts` — new share-link rewrite pass (strip-or-rewrite).
- `src/renderer.ts` / `src/renderer/*` — `standalone` flag wiring (suppress
  sidebar/nav).
- `src/markdown.ts` / frontmatter parsing — surface the `share` field.
- Tests: `src/tests/build.test.ts`, `src/tests/render-static.test.ts`.

## Housekeeping

- **Fix CLAUDE.md:** it states config is JSON in `.glint/config.json`. Actual
  format is **TOML** (`glint.toml` or `.glint/config.toml`, parsed by
  `smol-toml`). Correct this while in here.

## Open questions / risks

- Closure walk depth is unbounded by design (`closure: true` is an explicit
  opt-in). Cycle guard is required; a runaway closure would over-share, but that
  is the user's stated choice. Consider logging the closure size at build time.
- Frontmatter `share` schema should be validated (zod) and produce a clear
  build error on malformed input rather than silently skipping.

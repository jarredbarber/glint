# What Glint Is

*Design proposal for issue #11. Written 2026-08-23.*

## One sentence

**Glint renders *technical* Markdown — math, diagrams, citations — into self-contained output, delivered through three thin surfaces.**

Two axes define it. **Purpose:** technical and scholarly authoring — that's *why* the pipeline has KaTeX, mermaid, and citations instead of a blog theme system. **Packaging:** three thin surfaces (render / serve / embed) that all run the same pipeline. Purpose decides what features exist; packaging decides where they run. Everything that serves neither is a candidate for deletion.

## The one asset

The `remark → rehype` pipeline is the whole product: server-side KaTeX, syntax highlighting, mermaid, wiki-links, citations, task/comment widgets, source-line mapping. It has no external API dependencies and produces self-contained output. That is the thing worth defending. Every surface below is just a different way to feed markdown in and get rendered HTML out.

**The razor:** a proposed pipeline feature is in-scope only if it serves technical or long-form authoring. Math, diagrams, callouts, definition lists, footnotes, citations, cross-references, **in-file review/comment threads** → yes — feedback is a core part of writing technical docs. Blog templating, social embeds, live multi-user collaboration servers, analytics → no. When in doubt, ask what a person writing a paper, a spec, or research notes needs.

## The three surfaces (and nothing else)

| Surface | Command | Input → output | Owns |
|---------|---------|----------------|------|
| **Render** | `glint render` / `--stdin --body-only` | one file (or stdin) → one HTML file (or fragment) | nothing but the pipeline + inlining |
| **Serve** | `glint serve` | a directory → a live personal wiki | editing, comments, tasks, journal, storage, hot-reload |
| **Embed** | Chrome extension (#9) | a remote `.md` URL → rendered in-browser | remote backends, sanitization |

Render is the floor (pipeline only). Serve is the ceiling (pipeline + statefulness). Embed is Render running in someone else's tab.

## Tenets

0. **Technical writing is the domain.** The feature set exists to serve math, diagrams, citations, cross-references, and structured long-form docs. This is the identity, not an accident of what got built. Apply the razor above to every feature request.
1. **Zero external render dependencies.** No calls to a math API, no CDN at render time. Server-side or bust. This is the differentiator; never trade it away.
2. **Self-contained output.** `glint render` produces one file that works offline forever. The Chrome extension inherits the same constraint.
3. **The pipeline is shared, not forked.** All three surfaces run the *same* remark/rehype stages. A feature added to the pipeline (a new widget, a new callout) shows up everywhere for free. If a feature only makes sense on one surface, it lives on that surface, not in the pipeline.
4. **Single-user *stack*, multi-author *content*.** The `serve` process is single-user with no auth or multi-tenancy — access control is the network's job (decided when auth was cut). But review is core to technical writing, so *multiple people collaborate through the files*: comments are `author@date` threads stored in the `.md` itself, synced via git (§tenet 5), reviewed the way code is. What's out of scope is a *live collaboration server* — presence, cursors, real-time co-editing. Async, file-based feedback is in; a realtime backend is not.
5. **Files are the source of truth.** Plain `.md` on disk (or in git). No database, no proprietary format. Widgets — including comment threads — are plain-text syntax that degrades gracefully in any other viewer. This is also what makes multi-author feedback work without a server: the file *is* the shared state.

## Target use cases

1. **"Render this one file nicely"** — a paper, notes, a README with math → a shareable HTML file. (`render`)
2. **"Browse and edit my notes folder"** — a personal Obsidian-lite with real math and live reload, served on localhost or a Tailnet. (`serve`)
3. **"Read this markdown on the web the way I like it"** — GitHub/Drive/HTTP `.md` rendered with Glint's pipeline instead of the site's default. (`embed`, #9)

One persona: **a technical person writing and circulating their own markdown docs.** Others read and comment via the shared files (git), but there's no team server, publishing platform, or CMS.

## Explicitly out of scope

- **Static *site* generation** — already removed; do not bring back. `render` does one file; multi-page site builds are a different product.
- **Auth / multi-tenant / sharing servers** — already removed; the network layer owns access. (Multi-*author* feedback is fine — it happens in the files, see tenet 4.)
- **Live collaboration** — presence, real-time multi-cursor, a co-editing backend. Feedback is async and file-based (comment threads + git), not a realtime server.
- **Being a general CMS or blog engine.** No templating, no theming DSL beyond the built-in themes, no plugin marketplace.
- **A second rendering path.** Chromedown must adopt Glint's pipeline, not run a parallel one (see the #9 warning below).

## What this decision unblocks

- **#9 (chromedown):** the integration proposal's `extensions/` + `packages/glint-render` monorepo split is over-built for this identity. Tenet 3 says: **extract the shared pipeline into one module both surfaces import; don't stand up a workspace monorepo with `backends/auth` living on.** Absorb chromedown's *pipeline-relevant* parts (callouts, definition lists, DOMPurify-for-remote), drop anything that re-implements what serve already does. Rescope #9 to "port chromedown's renderer onto Glint's pipeline," not "vendor the whole repo."
- **#10 (file browser):** a browser is a *serve* concern only. Scope it to the wiki surface; don't generalize.
- **#1 (rename):** identity is "self-contained markdown rendering engine." Names that evoke render/mark/paper (`mark`, `nota`, `quill`) fit; the pick can now be made against a real identity instead of vibes.

## Non-goals for *this* doc

This defines the boundary, not the roadmap. It does not redesign the editor (#8) or the file browser (#10) — it just says which surface they belong to.

# Serve-surface file browser and wiki navigation proposal

## Scope and decision

This note covers **only Glint's served SPA**: the browser that opens a local folder, Google Drive folder, or GitHub subtree. It does not propose a file browser, router, or inter-page navigation contract for `glint render` or an embedded/standalone document. Those surfaces deliberately render one document without a workspace ([`docs/project-identity.md`](project-identity.md), lines 7–22).

**Recommendation:** retain the existing `StorageAdapter` seam and its direct source routes, but make the selected document a URL-visible, source-relative path. Treat `FileMeta.path` as the canonical navigator identity, retain `FileMeta.id` solely as the opaque adapter operation key, and resolve short wiki names only when they are unique.

This is a source review, not a runtime evaluation. “Observed” statements below are grounded in the named source and test files; “recommendation” statements are proposed work.

## Current behavior (observed)

### Source entry and page selection

* `parseRoute()` accepts a hash as a backend plus slash-separated remainder, and `pickAdapter()` turns `#/local`, `#/drive/<folderId>`, and `#/gh/<owner>/<repo>/<path>@<ref>` into an adapter ([`src/spa/app.ts`](../src/spa/app.ts), `parseRoute`, lines 27–59). The landing page advertises those same direct source routes (lines 425–465).
* `boot()` authenticates, calls `adapter.list()`, renders the sidebar, then always calls `openFile(files[0].id)` when the list is nonempty (lines 516–550). The current URL carries a source but not the selected file or a heading. File, search-result, and wiki clicks use `preventDefault()` and call `openFile()` without changing the hash (lines 241–262, 265–281, 417–422). Consequently reload, copied URL, and Back/Forward cannot restore a page selection within a source.
* `openFile(id)` reads through a process-wide `Map<string, string>` cache, renders Markdown with `knownPaths: files.map(f => f.name)`, replaces `.content-wrapper`, rewires wiki links, then rerenders the sidebar (lines 72–78 and 165–180). It has no request/version token. Two rapid selections can therefore complete out of order and let an older `read()`/render overwrite the newer selection.
* The cache is keyed only by adapter-local `id` and is not cleared when `hashchange` invokes `boot()` for another source (lines 76, 165–172, 546–551). `FileMeta` promises only that `id` is an adapter input; it does not make it globally unique ([`src/spa/storage/types.ts`](../src/spa/storage/types.ts), lines 32–40). Local and GitHub adapters use source-relative paths as ids ([`src/spa/storage/local.ts`](../src/spa/storage/local.ts), lines 63–93; [`src/spa/storage/github.ts`](../src/spa/storage/github.ts), lines 94–128). Thus two sources containing the same path can receive stale content from a previous source.

### File browser

* `buildFileTree(files)` constructs an in-memory, source-root-relative tree from `FileMeta.path`; folders precede files and siblings sort case-insensitively with numeric ordering ([`src/spa/file-tree.ts`](../src/spa/file-tree.ts), `buildFileTree`, lines 22–60). The dedicated test fixes that nested-tree and order behavior ([`src/tests/file-tree.test.ts`](../src/tests/file-tree.test.ts), lines 7–31).
* `renderFileTree()` emits all files as `href="#"` links and each folder as native `<details><summary>` disclosure; `renderSidebar()` regenerates the entire sidebar on every file open ( [`src/spa/app.ts`](../src/spa/app.ts), lines 384–423). It marks the selected link with `aria-current="page"`.
* Folder expansion lives only in the module-level `expandedFolders` set. Recreating the sidebar replays it, but a page reload loses it; a route change can also carry same-named folder state into another source (lines 76–78, 390–392, 411–416).
* The browser is a complete eager DOM tree: it builds every node and listener after each page render. This is simple and correct for a small workspace, but the work and DOM size grow with every listed Markdown file.
* “New page” accepts a standalone name; `normalizePageName()` rejects `/`, so the SPA can create a root page but cannot create a page inside an existing folder ([`src/spa/wiki-links.ts`](../src/spa/wiki-links.ts), lines 14–19; [`src/spa/app.ts`](../src/spa/app.ts), lines 182–200 and 402–405). This is an SPA policy, not a stated adapter limitation: `create(name, content)` already receives a string name ([`src/spa/storage/types.ts`](../src/spa/storage/types.ts), lines 36–40).

### Search

* Each input event starts `renderSearch()`. For every file whose text is not cached, it awaits `adapter.read()` in sequence, then matches the raw filename or full body case-insensitively; it renders a flat list of matching filenames ([`src/spa/app.ts`](../src/spa/app.ts), lines 241–263 and 408–410; [`src/spa/wiki-links.ts`](../src/spa/wiki-links.ts), `matchesWikiSearch`, lines 21–24). The test covers title/body case-insensitive matching, not remote-search behavior ([`src/tests/wiki-search.test.ts`](../src/tests/wiki-search.test.ts), lines 5–9).
* `searchGeneration` prevents a stale search from painting after an awaited read, but it neither debounces input nor cancels already-started reads (lines 241–255). On a cold remote workspace, consecutive keystrokes can initiate overlapping scans; an empty query also reads every uncached page before displaying every page. Search has no result count, empty state, path disambiguation, keyboard result model, or retained query after selecting a result.

### Wiki rendering and traversal

* The shared Remark plugin recognizes `[[Target]]` and `[[Target|Label]]`, appends `.md` if the target does not end with lowercase `.md`, and emits `/f/<encoded-target>` with `internal-link`; failed validation also gets `broken-link` ([`src/remark-wiki-link-glint.ts`](../src/remark-wiki-link-glint.ts), lines 13–80). The processor installs it before Markdown-to-HTML conversion ([`src/pipeline.ts`](../src/pipeline.ts), lines 36–67).
* The browser renderer validates against an exact `Set` of the supplied `knownPaths` ([`src/browser.ts`](../src/browser.ts), lines 12–46); the SPA supplies only basenames (above). By contrast, SPA click handling strips text after `#` and calls `resolveWikiLink()`, which compares only a lowercased basename and returns the **first** match ([`src/spa/app.ts`](../src/spa/app.ts), lines 159–180 and 265–281; [`src/spa/wiki-links.ts`](../src/spa/wiki-links.ts), lines 3–12).
* This creates several inconsistent outcomes: `[[Guides/Welcome]]` cannot resolve even though that path is in the file tree; duplicate `notes.md` files resolve arbitrarily by list order; case-insensitive traversal can work while exact renderer validation displays `broken-link`; and a `#heading` suffix is discarded instead of being scrolled to. `Foo.MD` is also treated by the plugin as extensionless because its suffix check is case-sensitive. The current resolver test covers only unique basename lookup ([`src/tests/wiki-resolve.test.ts`](../src/tests/wiki-resolve.test.ts), lines 5–18).
* Unknown pages prompt to create a root-level normalized page ( [`src/spa/app.ts`](../src/spa/app.ts), lines 182–200 and 265–281). That is useful for a small personal wiki, but it turns a typo and an ambiguous target into the same creation-oriented flow.
* `remark-wiki-link-glint` is shared with non-SPA rendering. The render surface intentionally treats its wiki links as inert because it has no workspace target list ([`src/render.ts`](../src/render.ts), lines 156–170). That confirms the file-browser proposal must keep its routing behavior in the serve surface rather than make standalone output depend on a workspace.

## Concrete limits and their consequences

| Limit | User-visible consequence | Underlying cause |
| --- | --- | --- |
| No document state in the URL | A page cannot be bookmarked, shared, restored after reload, or revisited with browser history. | Only the source route changes the hash; all document links are `#` plus JavaScript. |
| Adapter-local cache reused across sources | Switching projects can show the wrong document when ids collide. | `contentCache` is global and keyed by `id` alone. |
| Async page loads have no latest-selection guard | Fast navigation can show content for a previous click while the sidebar identifies another page. | `openFile()` writes shared UI after awaits without checking request freshness. |
| Basename-only wiki identity | Nested links fail; duplicate names are silently nondeterministic; broken styling and click behavior disagree. | Renderer validation is exact-string while SPA resolution is case-folded basename first-match. |
| Heading target is lost | A link intended for a section opens a page but not its section. | Click handling strips the suffix and has no post-render scroll action. |
| Cold search is repeated remote full-text retrieval | Typing may produce many reads and make large Drive/GitHub folders sluggish. | One sequential scan per input event; cache is the only mitigation. |
| Eager sidebar rerender | Large workspaces repeatedly allocate tree HTML and listeners; search and focus state disappear on page change. | `openFile()` always calls `renderSidebar()` and there is no incremental state/view model. |
| Root-only creation | The browser displays folders but cannot add a new page where it belongs. | SPA validation rejects `/` before `adapter.create()`. |

## Ranked, small roadmap

### 1. P0 — Make page selection canonical, direct, and race-safe

**Recommendation.** Add a serve-only navigation module in `src/spa/` with one small interface:

```ts
type PageLocation = { sourceHash: string; path?: string; heading?: string };
```

`path` is the exact source-root-relative `FileMeta.path`; `heading` is an optional rendered heading id. Encode it in the existing hash as fragment query parameters, for example:

```
#/gh/acme/wiki/docs@main?file=Guides%2FWelcome.md&heading=intro
#/drive/1a2b...?file=Notes.md
```

The parser must split the fragment's source portion from its query before applying today's GitHub-route parsing. A route with no query remains a valid existing direct source route and continues to open its deterministic fallback page. Page selection should set the hash (or use the History API with equivalent traversal semantics), so normal browser history owns document-level navigation instead of a second in-memory history.

After `adapter.list()`:

1. Build a `Map` by **exact path** and select the requested path, otherwise select the documented fallback.
2. Resolve that `FileMeta` to `adapter.read(file.id)`. Do not ask an adapter to read by path.
3. Scope `contentCache` to an immutable source key, or clear it whenever the source key changes. Keep each cache entry's listed `version` and invalidate when the existing focus refresh detects a version change.
4. Give every `openFile` request a monotonically increasing navigation token. After each `await`, render only when its token is still current. On success, focus a stable content heading/main landmark and, if present, scroll the requested heading into view.

This is the highest-priority work because it removes incorrect cross-source content, makes direct navigation real at document granularity, and provides the one identity rule required by every later improvement. It adds no adapter method and preserves `FileMeta.id`, version conflict handling, and existing source hashes.

### 2. P1 — Replace ambiguous wiki lookup with one indexed resolver

**Recommendation.** Make a serve-only `WikiIndex` from the one `adapter.list()` result and use it for validation, link wiring, creation decisions, and the file browser. Its public result should express the three meaningful states:

```ts
type WikiResolution =
  | { kind: 'resolved'; file: FileMeta; heading?: string }
  | { kind: 'missing'; requestedPath: string }
  | { kind: 'ambiguous'; requestedName: string; candidates: readonly FileMeta[] };
```

Resolution rules, in order:

1. Parse `[[source-relative/path#heading|label]]` once, normalizing only Unicode and the optional `.md` suffix—not the stored path.
2. Match a supplied path against `FileMeta.path`; this is exact and unambiguous.
3. For an unqualified basename, resolve only if the normalized basename map has exactly one candidate. Return `ambiguous` otherwise, displaying candidate source-relative paths instead of selecting the first one.
4. Create only for `missing`; never offer creation for `ambiguous`. Support the current root-page prompt initially, then allow a validated source-relative path only after confirming all existing adapters can create its parent folders (or add an explicit folder-creation capability rather than pretending they can).

Have `wireWikiLinks()` rewrite only SPA-owned wiki anchors to the canonical page hash and determine their visual state from `WikiIndex`; keep `remark-wiki-link-glint`'s generic Markdown transformation and the standalone renderer's inert-link behavior unchanged. This is deliberately a serve-surface adaptation at the storage/listing seam, not a new rendering-surface contract. Test duplicate basenames, nested paths, case behavior, `.MD`, missing vs ambiguous targets, heading navigation, and a direct page route.

### 3. P2 — Make browsing scale without turning it into a custom tree widget

**Recommendation.** Keep native `<details>/<summary>` disclosures and ordinary links. They already match the browser's disclosure semantics; the HTML Standard defines `details` as a disclosure widget and `summary` as its label ([WHATWG HTML, “The `details` element”](https://html.spec.whatwg.org/multipage/interactive-elements.html#the-details-element)). Do **not** add `role="tree"` merely for appearance: the W3C tree-view pattern entails tree/treeitem/group roles and a substantial arrow-key, Home/End, and type-ahead interaction model ([W3C WAI-ARIA APG, “Tree View Pattern”](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/)).

The smaller path is:

* keep `aria-current="page"`, give the search results an accessible count/empty message, and move focus to the loaded document's heading after an explicit navigation;
* persist only expansion paths and the last query under a source-scoped UI-state key; restore them after sidebar rendering, never across sources;
* debounce search input, trim an empty query to “show no results,” and evaluate it against a bounded local search index populated opportunistically from reads. Do not add a search method to `StorageAdapter`; full text is not a capability it currently promises;
* show source-relative path alongside every result where the basename is duplicated; and
* avoid recreating the sidebar when only content changes. Update the prior/current link's `aria-current` state and preserve the search element, results, and DOM focus. If real workspace measurements later show the tree itself is the bottleneck, virtualize only the flat search-result list first; defer tree virtualization until then.

The browser-history portion of P0 uses platform navigation/session-history behavior rather than inventing a parallel model; the relevant normative platform reference is [WHATWG HTML, “APIs related to navigation and session history”](https://html.spec.whatwg.org/multipage/nav-history-apis.html).

## Explicit non-goals

* No server-side listing/search endpoint, database, account model, or CMS behavior.
* No changes to `StorageAdapter`, backend-native access, ids, versions, or write-conflict behavior.
* No shared-workspace router for `glint render`, exported HTML, or embedding.
* No custom ARIA tree or keyboard-command framework before product evidence requires one.
* No automatic creation from an ambiguous wiki target.

## Suggested acceptance checks for implementation

1. Open two sources that both contain `Notes.md` with different contents; switch between their direct hashes and verify the selected document is never served from the other source's cache.
2. Load a URL with `?file=Guides%2FWelcome.md&heading=intro`; it opens that file and reaches `#intro`. Reload and browser Back/Forward preserve the selected page.
3. From `[[Guides/Welcome]]`, navigate to the nested file. From an unqualified duplicate basename, show disambiguation rather than choosing a file. A missing target alone offers creation.
4. Trigger two delayed reads in reverse completion order; only the latest selected file renders.
5. On a cold mocked remote adapter, type a multi-character query and assert debouncing produces one scan; ensure search UI reports no results and displays duplicate paths.
6. Verify native disclosure toggling, Tab navigation, `aria-current`, search result status, and post-navigation content focus without assigning tree roles.

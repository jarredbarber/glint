# Glint SPA — Drive / GitHub / Local wiki (design)

*Design spec. 2026-08-23. Issue #19. Supersedes the `serve` surface.*

## Summary

Deliver Glint as a **static single-page app**: point it at a GitHub repo folder, a Google Drive folder, or a local directory, and it becomes a live wiki — browse, render, edit, comment, follow wiki-links. No server. Access control is delegated entirely to the backend (GitHub repo permissions, Drive sharing, local filesystem access) — Glint holds no user database. This replaces and retires `glint serve`.

Feasibility of the core round-trip (Drive OAuth → read → edit → save → persist, server-less, no client secret) was proven by the spike on branch `spike/drive-spa` (issue #19, verdict GREEN 2026-08-23).

## Goals

- One static runtime, three storage backends behind a single seam.
- Auth = backend-native identity. Multiple people collaborate because they each have backend access to the files; comment/edit attribution comes from that identity.
- Core wiki loop: folder browser, render, inline section edit, in-file comments, `[[wiki-link]]` navigation across files.
- Shareable: a wiki (and a file within it) is a URL.
- Zero server, ever. Deployable to GitHub Pages.

## Non-goals (v1)

- Task and journal **aggregation** dashboards — dropped (also being removed from Glint generally).
- Realtime collaboration — no live cursors, presence, or co-editing. Feedback is async and file-based.
- Non-Chromium local editing — the local backend uses the File System Access API (Chromium/Edge only). Drive and GitHub work in any modern browser.
- SSE live-reload — dies with `serve`. Replaced by refetch-on-focus + manual refresh.
- Non-Drive/GitHub cloud backends (generic HTTP, etc.) — later, if ever.

## Settled decisions

| Decision | Choice |
|----------|--------|
| Scope | Core loop + wiki-links; no task/journal aggregation |
| Backends | Drive (GIS token), GitHub (device flow), Local (File System Access API) |
| GitHub auth | OAuth **device flow** — pure static, no client secret, no server |
| serve | **Retired.** Local editing moves to the FS Access API backend |
| Identity | Backend-native; no Glint user DB |
| Code structure | Approach B: reuse the render pipeline + CodeMirror widget; rewrite the session/save/line-mapping orchestration against the storage seam, using the section-as-unit design from the #8 editor review |
| Hosting | Static → GitHub Pages |

## Architecture

### Storage seam

The one abstraction everything pivots on. `src/spa/storage/types.ts`:

```ts
interface FileMeta { id: string; name: string; path: string; version: string; }

interface StorageAdapter {
  auth(): Promise<void>;                 // backend-specific login
  identity(): { name: string };          // for comment attribution
  list(): Promise<FileMeta[]>;           // files in the workspace folder/repo
  read(id: string): Promise<{ content: string; version: string }>;
  write(id: string, content: string, version: string): Promise<{ version: string }>;
}
```

- `version` is the backend's native concurrency token: Drive `modifiedTime`, GitHub blob `sha`, local `lastModified`. `write` with a stale `version` is a conflict (the adapter re-checks and rejects) — this is optimistic locking, replacing the server's content-hash check.
- A 4th in-memory `FakeAdapter` backs unit tests.

### Adapters

**Drive** (`storage/drive.ts`)
- Auth: Google Identity Services token client (proven in spike). Scope: **`drive.file`** + Google Picker for folder selection (least privilege; avoids the restricted-scope security assessment when the app is later published).
- list/read/write: Drive REST (`files.list` scoped to the picked folder, `files.get?alt=media`, `PATCH /upload/.../{id}?uploadType=media`).
- **Known risk (spike first):** `drive.file` only exposes files the app created or the user opened via Picker. Listing a *folder's children* under `drive.file` may require the folder to be granted via Picker, or per-file grants. If unworkable, fall back to `drive.readonly`+`drive.file` combination or a broader scope with a documented tradeoff. **This is the highest-risk unknown — spike it before building the Drive adapter.**

**GitHub** (`storage/github.ts`)
- Auth: OAuth **device flow** — `POST /login/device/code` (client_id only), user enters code at github.com/login/device, poll `/login/oauth/access_token`. No client secret ⇒ works from static. Token cached in localStorage.
- Workspace = `owner/repo[/path][@ref]`. list = Contents API / git tree; read = contents (base64) or raw; write = `PUT /repos/{o}/{r}/contents/{path}` with the file's blob `sha` (stale sha ⇒ 409 conflict). Commits attributed to the authenticated user.
- **Spike:** confirm device-flow token scope grants private-repo read+write.

**Local** (`storage/local.ts`)
- Auth: `showDirectoryPicker()` → `FileSystemDirectoryHandle`. Handle persisted in IndexedDB; on return, re-request permission (`queryPermission`/`requestPermission`).
- list = iterate directory handle; read/write via file handles; `version` = file `lastModified`.
- Chromium/Edge only — feature-detect and hide the local option elsewhere.
- **Spike:** handle persistence + re-permission UX across reloads.

### App shell (`src/spa/app.ts`)

- **Workspace as URL** (the "share a link" payoff): `#/gh/owner/repo/path`, `#/drive/<folderId>`, `#/local`. File routes nest: `#/gh/owner/repo/notes/foo.md`. Local can't encode a handle → `#/local` resolves the persisted IndexedDB handle (or prompts to pick).
- Flow: parse workspace URL → `adapter.auth()` → `adapter.list()` → render sidebar file browser + resolve entry file → render via the `glint-render` bundle (#14).
- **Wiki-links:** `[[Name]]` resolves against `list()` by filename → routes to that file. Unresolved links render as "missing" (create-on-click deferred).

### Editor / comment orchestration (rewritten)

- Reuse the standalone leaves: the `glint-render` pipeline bundle and the `editor.ts` CodeMirror widget.
- Rewrite the session/save/line-mapping layer against the seam, using the **section-as-unit** model from `docs/editor-review.md`: edit a whole `<section>` located by `data-section-line`; hidden set = the section's own subtree; no ±5-line buffer; no global heading rescans.
- Save: `adapter.write(id, content, version)`; stale `version` ⇒ conflict warn + reload.
- Comments: in-file `author@date` blocks (unchanged format), stamped with `adapter.identity().name`.
- Carries a leave-behind test: `getSectionRange(section)` returns `[sectionLine, nextSectionLine)` and hide-set == subtree (from the #8 review).

### Reload

Refetch the current file on `window` focus; a manual refresh button. No SSE.

### Auth / token storage

- Drive: access token in memory + sessionStorage (~1h; re-consent silently or on demand).
- GitHub: device-flow token in localStorage.
- Local: dir handle in IndexedDB (+ re-permission prompt).

### Build & host

- esbuild bundles `src/spa/` to static assets (extends the existing bundle setup).
- Deploy to GitHub Pages.
- Google OAuth client: authorized JS origin = the Pages origin; consent screen in Testing mode + explicit test users (zero verification) until/unless world-public is wanted.
- GitHub: an OAuth App with device flow enabled.

## Migration / deletions

- **Extract the remark→rehype pipeline out of `server.ts`** into a shared module consumed by both `glint render` (CLI) and the SPA bundle. This is a prerequisite refactor.
- **Delete:** Fastify server, server auth, SSE, `src/server/routes/*`, server-side storage providers (Local/Git), the `serve` CLI command.
- **Keep:** the pipeline, `glint render` CLI, `editor.ts` CodeMirror widget, comment/task *rendering* widgets (rendering, not aggregation).

## Testing

- `FakeAdapter` unit tests for the seam contract (list/read/write/optimistic-lock).
- `getSectionRange` unit test (the money path from #8).
- Each real adapter gets a thin manual smoke checklist (can't unit-test third-party OAuth); the build-phase spikes double as those.

## Risks — spike during build, highest first

1. **Drive `drive.file` folder listing** — can the app enumerate a picked folder's `.md` children? Blocks the Drive adapter. Spike before building it.
2. **GitHub device-flow scope** for private-repo read+write.
3. **FS Access API** handle persistence + re-permission across sessions.

## Sequencing

1. Extract shared pipeline module out of `server.ts`.
2. Storage seam + `FakeAdapter` + section-as-unit editor orchestration (backend-agnostic; fully testable).
3. App shell: workspace URL routing, sidebar, render, wiki-links (against FakeAdapter).
4. Drive adapter (after its spike) — the #1 use case.
5. GitHub adapter (after its spike).
6. Local adapter (after its spike).
7. Delete serve + server stack.
8. Pages deploy.

Steps 4–6 are independent once the seam exists.

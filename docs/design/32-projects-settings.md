# Projects and local settings

**Status:** Proposed for approval in [#32](https://github.com/jarredbarber/glint/issues/32)

## Decision

A **Project** is a browser-local bookmark to one backend-owned source. It has a stable local ID, display name, and enough source metadata to construct the existing `StorageAdapter`. It is not a workspace container, file copy, account, permission object, or synchronization unit.

**Settings** are two preferences shared by all Projects in this browser: theme and Vim bindings. Store Projects and Settings as one versioned JSON record in `localStorage`. Store only local directory handles in IndexedDB. Add no dependency, server, account system, cloud sync, or provider registry.

## Current constraints

- The [product identity](../project-identity.md) says files are the source of truth, the chosen backend owns access control, and the deployed SPA has no credential store.
- Current routes open local, Drive, and GitHub sources through the existing adapters. Keep those direct routes for first open and sharing.
- The local adapter currently retains one `FileSystemDirectoryHandle` at IndexedDB key `dir`; GitHub currently retains a PAT at `glint-gh-token`; Drive tokens are memory-only.
- The SPA currently defaults to the `nord` theme and enables Vim bindings.
- `localStorage` is per-site string storage that lasts beyond the current session and can reject writes when disabled or over quota ([HTML Web Storage](https://html.spec.whatwg.org/multipage/webstorage.html)). It is sufficient for this small metadata record, not files.

## Version 1 schema

Storage key: `glint-spa-state`. Keep the existing `glint-spa` IndexedDB database and `handles` store; key each local handle by Project ID.

```ts
type ProjectSourceV1 =
    | { kind: 'local' }
    | { kind: 'drive'; folderId: string }
    | { kind: 'github'; owner: string; repo: string; path: string; ref: string };

type ProjectV1 = {
    id: string; // crypto.randomUUID(); also the local handle key
    name: string;
    source: ProjectSourceV1;
};

type PersistedStateV1 = {
    version: 1;
    projects: ProjectV1[];
    settings: {
        theme: string;
        vimMode: boolean;
        activeProjectId: string | null;
    };
};
```

Default: `{ version: 1, projects: [], settings: { theme: "nord", vimMode: true, activeProjectId: null } }`.

At load and save, `theme` must be one of the theme assets shipped by that build; otherwise use `nord`. Do not duplicate the theme list in the persisted-state schema. Version 1 has no timestamps, recent-file state, per-Project settings, cached backend data, or extension fields.

## Source identity and invariants

- Project IDs are unique UUIDs. `name` is trimmed, non-empty display text and is not identity.
- A Drive source is a trimmed, non-empty opaque `folderId`; duplicate identity is that exact ID. Google documents Drive IDs as unique, opaque, and stable across renames ([Drive files and folders](https://developers.google.com/workspace/drive/api/guides/about-files#file_characteristics)).
- A GitHub source lowercases non-empty `owner` and `repo`, removes empty and `.` path segments, rejects `..`, preserves path/ref case, and requires a non-empty `ref`. Compare the tuple `(owner, repo, path, ref)`. GitHub's Contents endpoint uses those fields and documents owner/repo as case-insensitive ([GitHub Contents API](https://docs.github.com/en/rest/repos/contents?apiVersion=2022-11-28#get-repository-content)).
- A local source persists no path. Its handle lives in IndexedDB at the Project ID. Compare a new handle with saved handles using native `isSameEntry()` ([File System Standard](https://fs.spec.whatwg.org/#dom-filesystemhandle-issameentry)).
- Source identity is unique. Adding a duplicate selects the existing Project without renaming it.
- `activeProjectId` is `null` or references an existing Project. Project order is insertion order.
- A Project can remain saved while offline, signed out, denied permission, not found, or missing its local handle; those failures never delete it.
- Project persistence never contains or changes files, file lists, permissions, concurrency tokens, or backend responses.

## Minimal seam and lifecycle

Keep `StorageAdapter` unchanged; #29 owns its design review. One app-state module owns `load`, `save`, reset, defaults, validation, and the two browser-storage key locations. A small concrete local-handle store owns IndexedDB `get`, `put`, `delete`, and iteration for deduplication. Project resolution converts a validated source into an existing adapter; do not add a provider interface.

A picker or direct route validates, authenticates, and successfully lists a source before saving a new Project. Cancelled auth, denied permission, not-found, and network failure leave no new bookmark. After save, use `#/p/<project-id>` as the local canonical route; `#/settings` opens Settings.

If a save fails, keep the source open for this tab, retain the last successfully stored record, announce that changes will not persist, and do not claim the Project was saved. Best-effort delete any newly written unreferenced handle. Browser storage failures must not affect backend files.

Removing a Project confirms its name, removes its record, clears `activeProjectId` when needed, and deletes its local handle if present. Failure to clean up a handle is reported. Removal and reset never call a backend delete or revoke access.

## Loading, migration, and recovery

- Missing state uses the default.
- Only an exact, fully valid version 1 record loads. Invalid JSON, invalid fields, or any other version resets the record to defaults and shows “Local Projects and settings were reset because stored data was not supported.” This loses bookmarks/preferences, never backend files.
- Catch every `localStorage`/IndexedDB access error. If defaults cannot be written, run with ephemeral defaults and show “Changes will not be saved in this browser.”
- On first load with no state, migrate the existing IndexedDB `dir` handle into one local Project: write it under the generated Project ID, write the version 1 record, then delete `dir`. If migration fails, keep `dir`, use ephemeral defaults, and offer retry on the next load.
- Delete the legacy `glint-gh-token` during bootstrap and reset. Never migrate it.
- A valid local Project with no handle remains listed as unavailable with Reconnect and Remove actions. Reconnect is an explicit picker action and rechecks duplicate identity.

The File System Access specification supports retaining handles for later use, but recovered handles may require permission again and permission requests require user activation ([File System Access](https://wicg.github.io/file-system-access/#api-filesystemhandle)).

## UX and backend states

- Bare URL shows a **Projects** page: saved Projects in insertion order, source summaries, and the existing Local/Drive/GitHub open controls. With none, explain that Projects are bookmarks stored only in this browser.
- While open, a visibly labelled native `<select>` lists Projects as `name — source summary`. Selection navigates to `#/p/<id>`. Separate native buttons open another source and Settings.
- Do not silently open the first Project when the active ID is absent.
- Settings uses a labelled native theme `<select>`, a labelled “Use Vim key bindings” checkbox, and Project rows with rename, source summary, Open, and Remove. Changes apply immediately and persist; a failed save reverts the control and announces the error.
- Distinguish loading, successful empty source, missing local handle, permission denied, authentication failure, not found, and offline/network failure. Retain the Project and offer the relevant Reconnect, Sign in, Retry, Settings, or Remove action.
- Use native controls, visible labels, visible focus, heading focus after route changes, `role="status"` for progress, and `role="alert"` for blocking failures. Do not rely on color. Correctly used standard HTML controls expose name, role, state, and value ([WCAG 2.2 guidance](https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html)).

## Security constraints

Persist only Project IDs/names, normalized source locators, and the three settings fields. Directory handles stay in IndexedDB and are used only after browser permission checks. Render names and summaries as text.

GitHub/Drive tokens, OAuth codes and verifiers, client secrets, cookies, file contents/lists, cached responses, and backend concurrency tokens **must never persist** in `localStorage`, `sessionStorage`, IndexedDB settings records, URLs, logs, or Project names. GitHub and Drive credentials remain memory-only. Public OAuth client IDs remain deployment configuration, not Settings.

## Rejected alternatives

- Cloud settings/accounts/sync: contradict the static, backend-owned product model.
- IndexedDB for all state: unnecessary for a tiny JSON record; use it only for handles.
- Route strings as the schema or filesystem paths for local Projects: brittle and cannot identify multiple browser handles.
- Persisted credentials: would turn Glint into a credential store.
- Per-Project preferences, history, import/export, and custom picker widgets: no current requirement.
- A provider registry or new storage interface: duplicates the existing adapter seam and overlaps #29.

## Implementation acceptance criteria

- [ ] Exact version 1 state, defaults, runtime theme validation, source normalization, unique identities, and active-ID invariant round-trip under `glint-spa-state`.
- [ ] Local, Drive, and GitHub Projects reopen through existing adapters; duplicate sources select the existing Project.
- [ ] Local handles are keyed by Project ID, survive reload, deduplicate with `isSameEntry()`, and support unavailable/Reconnect behavior.
- [ ] Invalid/other-version data resets with notice; storage failures are ephemeral and announced; legacy `dir` migration preserves the old handle on failure.
- [ ] Bootstrap/reset removes `glint-gh-token`; no secret, file data, backend response, or concurrency token persists or enters a URL.
- [ ] Removing/resetting local state never deletes backend files, and failed handle cleanup is reported.
- [ ] Bare, direct-source, Project, and Settings routes expose the specified native controls, focus/announcement behavior, and distinct loading/empty/error states.
- [ ] Theme and Vim changes apply immediately, survive reload, and revert with an announced error when save fails.
- [ ] No cloud sync, account system, credential store, new dependency, per-Project settings, history, provider registry, or backend file-semantics change is introduced.

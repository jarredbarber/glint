# SPA image and asset handling

Status: proposed for human approval in [issue #30](https://github.com/jarredbarber/glint/issues/30). Revised 2026-08-25 to flatten the sidecar naming (Drive folder-proliferation feedback) and to evaluate GitHub user-attachments.

## Decision

Keep images as ordinary files **beside** their Markdown source, using a flat sibling name rather than a per-page folder:

```text
guides/setup.md
guides/setup.md.a1b2c3d4.png
```

Markdown stores a backend-neutral URL relative to the page:

```markdown
![Describe image](setup.md.a1b2c3d4.png)
```

The asset name is `<page-filename>.<shortid>.<ext>`: the page's own filename (including its `.md`) keeps the asset visibly associated with its page and sorted next to it, `<shortid>` is a random token, and `<ext>` is a canonical image extension. Because the name does not end in a Markdown extension, `list()` on every adapter already filters it out of the sidebar.

This flat form replaces the earlier `<page>.md.assets/<uuid>.<ext>` folder proposal. It removes the need to create (and later garbage-collect) a directory per page, which matters most on Drive where every folder is a real metadata object; it keeps the same portable, page-relative Markdown reference on all four backends; and `glint render` already resolves and inlines any relative sibling path, so no CLI change is required.

Pasted images use a random `<shortid>` plus a canonical extension. The SPA uploads bytes through the selected storage adapter and only then inserts the relative reference. It never persists a Drive ID/URL, GitHub URL, `blob:` URL, or `data:` URL in Markdown.

Extend the existing `StorageAdapter` seam with only the operations every backend needs:

```ts
readAsset(path: string): Promise<Blob>;
createAsset(path: string, content: Blob): Promise<void>;
```

`path` is a normalized, workspace-root-relative POSIX path that resolves to a sibling of an existing Markdown page. `createAsset` writes a new file and never replaces one; `readAsset` returns opaque bytes and their media type. Adapter implementations hide Drive IDs, GitHub Base64, local handles, authenticated fetches, and MIME fallback. Neither method creates directories: flat sidecars live in a page's existing parent, so no adapter has to build or clean up a sidecar tree.

Do not add listing, update, delete, public-URL, cache, general binary-filesystem, or separate `AssetAdapter` interfaces. Issue #29 owns the broader `StorageAdapter` audit; #30 needs only this real multi-adapter seam.

## GitHub user-attachments (considered, not the default)

GitHub itself does not store dropped images in the repo. Its web editors upload them to a CDN and embed a `https://github.com/user-attachments/assets/<uuid>` URL. This is now reachable programmatically through an **undocumented** endpoint that accepts a bearer PAT:

```text
POST https://uploads.github.com/user-attachments/assets
      ?name=<file>&content_type=<mime>&repository_id=<numeric repo id>
Authorization: Bearer <token>
body: raw image bytes
→ JSON containing the github.com/user-attachments/assets/<uuid> URL
```

([community discussion #46951](https://github.com/orgs/community/discussions/46951), [island94.org write-up, 2026-08](https://island94.org/2026/08/programmatically-upload-attachments-to-github-issues-pull-requests-comments)).

Attractive properties: no repository bloat, CDN delivery, and the same asset store GitHub users already reach by paste.

Why it is **not** the default model:

- **Undocumented and unstable.** There is no REST/GraphQL surface and no compatibility promise; the endpoint's own discoverers say "I hope it doesn't go away." Making a serverless app's paste flow depend on an unversioned internal endpoint is fragile, and some token types (GitHub App installation tokens) already fail.
- **Non-portable Markdown.** The reference is a `github.com` URL, which is exactly what this design rejects everywhere else: `glint render` cannot inline it offline, standalone export cannot resolve it to `data:`, and a repo mirrored or moved off github.com loses its images. Reading private-repo attachment bytes back through the API/PAT is itself unreliable ([codenote](https://codenote.net/en/posts/github-issue-attachments-download-api-unsupported/)).
- **New CSP surface.** The live SPA's `img-src 'self' data: blob:` would have to admit the attachments host, and export could not inline these at all.

Recommendation: ship the portable in-repo sibling model below as the default on every backend, GitHub included. GitHub attachments can be reconsidered as an explicit per-repo opt-in, surfaced as "store images as GitHub attachments (not portable)", if and when GitHub documents a stable upload API. That opt-in is out of scope for the first implementation.

## Current constraints

- The static SPA has no asset server; the chosen Local folder, Drive folder, or GitHub subtree owns files and access control.
- Existing Markdown methods exchange strings and use backend concurrency tokens. `FileMeta.path` is the portable identity needed by image references; `FileMeta.id` is backend-specific.
- Local already traverses directory handles, Drive maps folder IDs to paths, and GitHub maps repository paths under a subtree. Each adapter has the context to resolve a sibling asset path.
- The image plugin preserves the Markdown destination in `data-glint-src`. In SPA mode it now keeps the original relative `src` verbatim rather than rewriting to a phantom `/api/asset/resolve` endpoint (#65); this design layers object-URL resolution on top of that relative `src`.
- Node `glint render` already reads a relative sibling like `doc.md.<id>.png` and inlines it as `data:`. Keep that behavior unchanged.
- SPA export currently downloads unresolved render output. Managed assets must be inlined because its export CSP permits `data:` but not `blob:`.
- The live SPA CSP already permits `blob:`/`data:` images and Drive/GitHub API connections; the portable model needs no new origin.
- Page deletion is exact-file only under #25 and does not cascade into a sidecar.

## Portable model

### Paths and names

For a Markdown workspace path `P`, paste to `<P>.<shortid>.<ext>` in the same directory as `P`: `guides/setup.md` uses `guides/setup.md.<shortid>.png`, stored relative to `dirname(P)` as `setup.md.<shortid>.png`.

- Use `/` on every backend.
- URI-decode and normalize `.`/`..` against the page parent; reject NULs, backslashes, empty final names, and any escape from the selected root.
- Continue reading valid relative references elsewhere, such as `../shared/logo.png`; paste always targets a sibling of the current page.
- Do not send absolute, HTTP(S), protocol-relative, or `data:` destinations to an adapter.

Generate `<shortid>` from [`crypto.getRandomValues`](https://w3c.github.io/webcrypto/#Crypto-method-getRandomValues) as 8 lowercase hex characters (32 bits). Collision within one page's handful of assets is negligible, and create-only writes turn any clash into a visible failure rather than an overwrite. Ignore clipboard filenames rather than sanitize backend-specific characters, and do not hash merely to deduplicate.

### Paste policy and ordering

Handle exactly one image file per paste; preserve ordinary text paste and reject multi-file paste unchanged. Clipboard file items are available through `clipboardData` and `getAsFile()` ([W3C Clipboard API](https://www.w3.org/TR/clipboard-apis/), [WHATWG `DataTransferItem`](https://html.spec.whatwg.org/multipage/dnd.html#the-datatransferitem-interface)).

Accept a non-empty image of at most **5,000,000 bytes**:

| MIME | Extension |
| --- | --- |
| `image/png` | `.png` |
| `image/jpeg` | `.jpg` |
| `image/gif` | `.gif` |
| `image/webp` | `.webp` |

Validate `Blob.size` and `Blob.type` before storage ([W3C File API](https://w3c.github.io/FileAPI/#blob-section)). Reject missing/other MIME types, including SVG paste. Existing SVG references may render only as `<img>` resources; never inject their markup. The ceiling fits Drive multipart upload, documented for files of 5 MB or less; larger files would need resumable state ([Drive upload guide](https://developers.google.com/workspace/drive/api/guides/manage-uploads)).

1. Intercept only a valid image paste in the active section editor.
2. Derive the sibling path, call `createAsset`, show uploading state, and serialize further image pastes.
3. On success insert `![Describe image](<relative-path>)` and select `Describe image` for replacement.
4. Save Markdown through the existing versioned `write` flow.

Upload-before-reference prevents broken saved links. A later save conflict or cancellation may leave an orphan sibling; that is safer than rollback after an ambiguous network result. Assets are immutable and have no caller-visible version: duplicate create fails, Markdown keeps its existing concurrency token.

### Preview and URL lifecycle

After rendering, resolve managed `data-glint-src` values against `FileMeta.path`, call `readAsset`, create object URLs, and assign them to `<img>`. External and `data:` images retain existing renderer behavior.

Object URLs retain their Blob mapping and later dereference fails after revocation ([W3C File API](https://w3c.github.io/FileAPI/#url)). Track URLs per render and revoke them after the image is removed when the page changes, re-renders, or unloads; never revoke immediately after assigning `src`.

A missing, denied, offline, or undecodable asset yields a visible per-image error with alt text, portable path, and retry/reconnect, without blanking the page. Add no persistent cache/offline mode: Local works without network while permission remains; Drive/GitHub require their existing auth/network paths.

### Standalone SPA export

Resolve managed paths through `readAsset` and emit `data:` URLs only in generated HTML. Never serialize render-time `blob:` URLs. If any managed read fails, abort and report every unresolved path rather than download a knowingly broken standalone file. External HTTP(S) images remain external.

Keep the export's `img-src data: https: http:` and the live SPA's `img-src 'self' data: blob:` policies. Export contains no credential, backend/download/resolver URL, or `data-glint-src`.

## Backend behavior

### Local

Resolve the sibling path under the selected handle: walk the page's parent segments with `getDirectoryHandle`, then `getFileHandle(name, { create: true })` and `createWritable` for the new asset, and `getFile` to read. These native operations address one child at a time and publish writes on close ([WHATWG File System](https://fs.spec.whatwg.org/)); the picker-selected directory is the authority boundary ([WICG File System Access](https://wicg.github.io/file-system-access/)). Preflight the final name and fail rather than replace. No sidecar directory is created. Propagate permission, missing-handle, disk, and close errors.

### Google Drive

Create the asset as a normal file **in the page's own parent folder**, with no sidecar folder. Resolve the parent folder ID from the page path, then create the image with one multipart `files.create` carrying name, canonical MIME, and that parent ID; read with authenticated `files.get?alt=media`. Fail if a same-named child already exists. Keep `drive.file`, selected-folder authority, and sharing unchanged. Retry 401 once after the existing reconnect flow; otherwise surface the failure unchanged. No resumable upload, provider metadata, or database.

### GitHub

Map the sibling path under the configured subtree/branch. Create with `PUT /repos/{owner}/{repo}/contents/{path}`, Base64 content, branch, and commit message; omit `sha` so it is create-only. GitHub requires Base64 and requires blob `sha` only for replacement ([Contents create/update](https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents)).

Read the same path with the raw media type. GitHub supports raw reads between 1 and 100 MB, so the 5 MB limit fits ([Contents read](https://docs.github.com/en/rest/repos/contents#get-repository-content)). Image upload and Markdown save are separate commits; do not add blob/tree/commit/ref plumbing to combine them. Conflicts leave Markdown unchanged and can leave the documented orphan. The undocumented user-attachments path above is intentionally not used here.

### Fake

Store `Blob`s in memory by normalized path; fail duplicate creates and missing reads.

## Security, errors, and rejected alternatives

- Never escape the selected root, overwrite assets, cascade page deletion, persist credentials/provider URLs, or insert Markdown before upload success.
- Keep bytes opaque and render only as `<img src="blob:…">`; do not inject SVG/XML/HTML. Fetch private bytes only through authenticated adapters and do not change backend sharing.
- Reject persisted data URLs: RFC 2397 calls them useful for short values; they bloat the Markdown conflict unit and diffs. Use them only at standalone export ([RFC 2397](https://www.rfc-editor.org/rfc/rfc2397)).
- Reject backend URLs in Markdown, including GitHub user-attachments: they couple source to provider identity/auth/branch, defeat `glint render` and standalone export, and depend on an undocumented endpoint. GitHub download URLs also expire and are intended for one use ([Contents read](https://docs.github.com/en/rest/repos/contents#get-repository-content)).
- Reject per-page sidecar folders: they add a create/garbage-collect step per page and multiply Drive folder objects with no portability gain over a flat sibling name.
- Reject a global asset directory, hashing/deduplication, resize/transcode, resumable upload, public URLs, automatic cleanup, and asset management. Flat page sidecars plus a short random id deliver the requested flow without those policies or dependencies.

## Implementation acceptance criteria

1. Local, Drive, GitHub, and Fake implement the two methods with normalized sibling paths and `Blob`s; existing Markdown operations and Node rendering remain unchanged.
2. Sidecar images render for root and nested pages on every real backend; a failed asset produces a per-image error without blanking the page.
3. Page replacement/re-render revokes its object URLs; Markdown/export contains no object, provider, credential, resolver URL, or `data-glint-src`.
4. One PNG/JPEG/GIF/WebP of 1–5,000,000 bytes uploads to `<page>.<shortid>.<ext>` beside the page before inserting a relative reference with replaceable alt text.
5. Text, empty, unsupported, multi-image, oversize, failed, and conflicted pastes behave as specified and never insert a premature reference.
6. Drive creates the asset in the page's own folder (no sidecar folder) via multipart upload and rejects ambiguous paths; GitHub uses raw read plus a create-only commit; Local remains under its selected handle.
7. Standalone export inlines every managed asset or starts no download and reports all failures.
8. No overwrite, asset list/update/delete, cascade/garbage collection, drag/drop, file picker, remote import, editing/transcoding, offline cache, GitHub-attachments path, or unrelated renderer change is added.

## Tracker check

No implementation issue currently duplicates this work: #25 defers asset deletion to #30, #29 owns the general seam audit, and the prior end-to-end ticket #39 was closed when the first draft was sent back for revision. A single reopened/new end-to-end implementation ticket is sufficient because storage, paste, preview, and export share this one contract.

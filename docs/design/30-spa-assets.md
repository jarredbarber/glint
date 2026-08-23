# SPA image and asset handling

Status: proposed for human approval in [issue #30](https://github.com/jarredbarber/glint/issues/30).

## Decision

Keep images as ordinary files beside their Markdown source, using Glint's existing page-local sidecar convention:

```text
guides/setup.md
guides/setup.md.assets/f47ac10b-58cc-4372-a567-0e02b2c3d479.png
```

Markdown stores a backend-neutral URL relative to the page:

```markdown
![Describe image](setup.md.assets/f47ac10b-58cc-4372-a567-0e02b2c3d479.png)
```

Pasted images use a native UUID plus a canonical extension. The SPA uploads bytes through the selected storage adapter and only then inserts the relative reference. It never persists a Drive ID/URL, GitHub URL, `blob:` URL, or `data:` URL in Markdown.

Extend the existing `StorageAdapter` seam with only the operations every backend needs:

```ts
readAsset(path: string): Promise<Blob>;
createAsset(path: string, content: Blob): Promise<void>;
```

`path` is a normalized, workspace-root-relative POSIX path. `createAsset` creates missing parent directories and a new file but never replaces one; `readAsset` returns opaque bytes and their media type. Adapter implementations hide Drive IDs, GitHub Base64, local handles, authenticated fetches, and MIME fallback.

Do not add listing, update, delete, public-URL, cache, general binary-filesystem, or separate `AssetAdapter` interfaces. Issue #29 owns the broader `StorageAdapter` audit; #30 needs only this real multi-adapter seam.

## Current constraints

- The static SPA has no asset server or `/api/asset/resolve`; the chosen Local folder, Drive folder, or GitHub subtree owns files and access control.
- Existing Markdown methods exchange strings and use backend concurrency tokens. `FileMeta.path` is the portable identity needed by image references; `FileMeta.id` is backend-specific.
- Local already traverses directory handles, Drive maps folder IDs to paths, and GitHub maps repository paths under a subtree. Each adapter has the context to resolve an asset path.
- The image plugin preserves the Markdown destination in `data-glint-src` but rewrites relative images to `/api/asset/resolve`. The SPA does not resolve that URL, so workspace images fail today.
- Node `glint render` already reads `doc.md.assets/image.png` and inlines it as `data:`. Keep that behavior unchanged.
- SPA export currently downloads unresolved render output. Managed assets must be inlined because its export CSP permits `data:` but not `blob:`.
- The live SPA CSP already permits `blob:`/`data:` images and Drive/GitHub API connections; no new origin is needed.
- Page deletion is exact-file only under #25 and does not cascade into a sidecar.

## Portable model

### Paths and names

For a Markdown workspace path `P`, paste to `P.assets/<uuid>.<ext>`. Keep the `.md` suffix in the directory name. Store the destination relative to `dirname(P)`: `guides/setup.md` uses `setup.md.assets/<uuid>.png`.

- Use `/` on every backend.
- URI-decode and normalize `.`/`..` against the page parent; reject NULs, backslashes, empty final names, and any escape from the selected root.
- Continue reading valid relative references elsewhere, such as `../shared/logo.png`; paste always targets the page sidecar.
- Do not send absolute, HTTP(S), protocol-relative, or `data:` destinations to an adapter.

Generate names with [`crypto.randomUUID()`](https://w3c.github.io/webcrypto/#Crypto-method-randomUUID). Ignore clipboard filenames rather than sanitize backend-specific characters, and do not hash merely to deduplicate.

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
2. Derive the UUID path, call `createAsset`, show uploading state, and serialize further image pastes.
3. On success insert `![Describe image](<relative-path>)` and select `Describe image` for replacement.
4. Save Markdown through the existing versioned `write` flow.

Upload-before-reference prevents broken saved links. A later save conflict or cancellation may leave an orphan; that is safer than rollback after an ambiguous network result. Assets are immutable and have no caller-visible version: duplicate create fails, Markdown keeps its existing concurrency token.

### Preview and URL lifecycle

After rendering, resolve managed `data-glint-src` values against `FileMeta.path`, call `readAsset`, create object URLs, and assign them to `<img>`. External and `data:` images retain existing renderer behavior.

Object URLs retain their Blob mapping and later dereference fails after revocation ([W3C File API](https://w3c.github.io/FileAPI/#url)). Track URLs per render and revoke them after the image is removed when the page changes, re-renders, or unloads; never revoke immediately after assigning `src`.

A missing, denied, offline, or undecodable asset yields a visible per-image error with alt text, portable path, and retry/reconnect, without blanking the page. Add no persistent cache/offline mode: Local works without network while permission remains; Drive/GitHub require their existing auth/network paths.

### Standalone SPA export

Resolve managed paths through `readAsset` and emit `data:` URLs only in generated HTML. Never serialize render-time `blob:` URLs. If any managed read fails, abort and report every unresolved path rather than download a knowingly broken standalone file. External HTTP(S) images remain external.

Keep the export's `img-src data: https: http:` and the live SPA's `img-src 'self' data: blob:` policies. Export contains no credential, backend/download/resolver URL, or `data-glint-src`.

## Backend behavior

### Local

Walk segments under the selected handle; create sidecar directories and the final file with `getDirectoryHandle`, `getFileHandle`, and `createWritable`, and read with `getFile`. These native operations address one child at a time and publish writes on close ([WHATWG File System](https://fs.spec.whatwg.org/)); the picker-selected directory is the authority boundary ([WICG File System Access](https://wicg.github.io/file-system-access/)). Preflight the final name and fail rather than replace. Propagate permission, missing-handle, disk, and close errors.

### Google Drive

Represent sidecars as normal Drive folders. Folders are metadata-only files with MIME `application/vnd.google-apps.folder` created through `files.create` ([Drive folder guide](https://developers.google.com/workspace/drive/api/guides/folder)). Resolve each segment by parent ID and name; create missing sidecars, and fail if lookup returns duplicate same-named children.

Create an image with one multipart `files.create` containing name, canonical MIME, and parent ID; read with authenticated `files.get?alt=media`. Keep `drive.file`, selected-folder authority, and sharing unchanged. Retry 401 once after the existing reconnect flow; otherwise surface the failure unchanged. No resumable upload or provider metadata/database.

### GitHub

Map the path under the configured subtree/branch. Create with `PUT /repos/{owner}/{repo}/contents/{path}`, Base64 content, branch, and commit message; omit `sha` so it is create-only. GitHub requires Base64 and requires blob `sha` only for replacement ([Contents create/update](https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents)).

Read the same path with the raw media type. GitHub supports raw reads between 1 and 100 MB, so the 5 MB limit fits ([Contents read](https://docs.github.com/en/rest/repos/contents#get-repository-content)). Image upload and Markdown save are separate commits; do not add blob/tree/commit/ref plumbing to combine them. Conflicts leave Markdown unchanged and can leave the documented orphan.

### Fake

Store `Blob`s in memory by normalized path; fail duplicate creates and missing reads.

## Security, errors, and rejected alternatives

- Never escape the selected root, overwrite assets, cascade page deletion, persist credentials/provider URLs, or insert Markdown before upload success.
- Keep bytes opaque and render only as `<img src="blob:…">`; do not inject SVG/XML/HTML. Fetch private bytes only through authenticated adapters and do not change backend sharing.
- Reject persisted data URLs: RFC 2397 calls them useful for short values; they bloat the Markdown conflict unit and diffs. Use them only at standalone export ([RFC 2397](https://www.rfc-editor.org/rfc/rfc2397)).
- Reject backend URLs: they couple source to provider identity/auth/branch, and GitHub download URLs expire and are intended for one use ([Contents read](https://docs.github.com/en/rest/repos/contents#get-repository-content)).
- Reject a global asset directory, hashing/deduplication, resize/transcode, resumable upload, public URLs, automatic cleanup, and asset management. Page sidecars plus UUIDs deliver the requested flow without those policies or dependencies.

## Implementation acceptance criteria

1. Local, Drive, GitHub, and Fake implement the two methods with normalized paths and `Blob`s; existing Markdown operations and Node rendering remain unchanged.
2. Sidecar images render for root and nested pages on every real backend; a failed asset produces a per-image error without blanking the page.
3. Page replacement/re-render revokes its object URLs; Markdown/export contains no object, provider, credential, resolver URL, or `data-glint-src`.
4. One PNG/JPEG/GIF/WebP of 1–5,000,000 bytes uploads to `<page>.assets/<uuid>.<ext>` before inserting a relative reference with replaceable alt text.
5. Text, empty, unsupported, multi-image, oversize, failed, and conflicted pastes behave as specified and never insert a premature reference.
6. Drive uses a normal folder plus multipart upload and rejects ambiguous paths; GitHub uses raw read plus a create-only commit; Local remains under its selected handle.
7. Standalone export inlines every managed asset or starts no download and reports all failures.
8. No overwrite, asset list/update/delete, cascade/garbage collection, drag/drop, file picker, remote import, editing/transcoding, offline cache, or unrelated renderer change is added.

## Tracker check

All open and closed issues were searched. No implementation issue duplicated this work: #25 defers asset deletion to #30, #29 owns the general seam audit, and #20 only tracks #30. One end-to-end follow-up, #39, is sufficient because storage, paste, preview, and export share this contract.

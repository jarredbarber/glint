# Drive comments and portable Markdown discussions

Status: proposed for issue [#31](https://github.com/jarredbarber/glint/issues/31)

## Decision

Keep fenced `comment` blocks in the Markdown file as Glint's only comment model. The Drive adapter continues to read and write file bytes; it does not list, create, update, delete, import, export, or synchronize native Drive comments. The storage seam and the `comment` syntax stay unchanged.

This is the smallest model that preserves Glint's product rule that files are the source of truth and that discussions remain portable across Drive, GitHub, local folders, and `glint render`. Issue [#27](https://github.com/jarredbarber/glint/issues/27) already delivered SPA authoring and replies, so approval of this design requires no implementation follow-up.

The human decision is whether to approve **Markdown-only discussions with no Drive Comments API integration**.

## Current constraints

- Glint has no database, account system, credential store, or server. The deployed SPA is static.
- `StorageAdapter` exposes file authentication, identity, list/read/write/create/delete operations. It deliberately has no comment interface.
- The Drive adapter stores Markdown as `text/markdown`, uses the file's `modifiedTime` as its concurrency token, and requests the per-file `drive.file` OAuth scope.
- The renderer recognizes fenced `comment` blocks. A block contains author-and-time entries and optional `#resolved`, `#important`, and `summary:` source directives. SPA authoring appends a block; replies append an entry through the active storage adapter. This design does not change that syntax or add new editor behavior.
- A rendered source line identifies a block only for the current document version. It is not a persistent thread ID.

## What the Drive Comments API provides

### Threads, replies, and state

Drive models a comment and its replies as a discussion. A comment has a Drive-assigned ID, author, timestamps, plain-text `content`, output-only `htmlContent`, replies, and output-only `resolved` and `deleted` state. A reply has its own ID and can carry `resolve` or `reopen`; a comment can only be resolved by creating such a reply. Deleted comments and replies have no content. Listing can include tombstones with `includeDeleted=true`. All non-delete comment methods require an explicit `fields` response mask. See Google's [comments guide](https://developers.google.com/workspace/drive/api/guides/manage-comments), [Comment resource](https://developers.google.com/workspace/drive/api/reference/rest/v3/comments), and [Reply resource](https://developers.google.com/workspace/drive/api/reference/rest/v3/replies).

Drive owns native comment identity. The returned author omits email address and permission ID, so it is not a durable identity that Glint can equate with the free-form author token stored in a Markdown entry. Creating an imported reply would also attribute it to the currently authenticated Drive user, not to the original Markdown author.

### Anchors and quoted text

Drive accepts an `anchor` as an opaque JSON string describing a region at a revision. Applications may define their own anchor format, and Drive stores and returns it, but Google Workspace editors treat API-defined anchors as unanchored comments. The resource can also carry `quotedFileContent` with a MIME type and plain-text value; quoted content describes what the comment refers to but is not a stable locator or identifier. Google's guide explicitly ties an anchor to a document revision. A line or range anchor can therefore become stale as Markdown bytes move, while `quotedFileContent` can be duplicated or edited. Neither field supplies a safe mapping to a fenced block.

### Permissions and scopes

Comment creation accepts `drive.file` or the broad `drive` scope; comment listing also accepts read-only scopes. Glint already uses `drive.file`, which Google recommends as a non-sensitive, per-file scope, so native comments would not by themselves justify broader authorization. Effective permission still belongs to Drive: the `commenter` role can view and add comments, while a `writer` can also modify file content. An implementation would need to honor `files.capabilities.canComment` rather than infer permission from the OAuth scope. See [comments.create authorization](https://developers.google.com/workspace/drive/api/reference/rest/v3/comments/create), Google's [scope guidance](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [Drive roles](https://developers.google.com/workspace/drive/api/guides/ref-roles), and the [`File` capabilities resource](https://developers.google.com/workspace/drive/api/reference/rest/v3/files).

A native commenter could discuss a file without permission to modify its Markdown bytes. That is a real Drive capability, but adopting it would make Drive-backed Glint behave differently from every other backend and would move discussion ownership out of the portable file.

### Change detection

`comments.list` can filter by `startModifiedTime`; a comment's `modifiedTime` advances when the comment or any reply changes. Consumers must paginate, with at most 100 comments per page, and request deleted tombstones explicitly. There is no `comments.watch` method. Drive push notifications support only `files.watch` and `changes.watch`, and require an HTTPS webhook receiver, which the static SPA does not have. The only direct browser model would be per-file polling or refetching comments on lifecycle events. See [`comments.list`](https://developers.google.com/workspace/drive/api/reference/rest/v3/comments/list) and Google's [push notification guide](https://developers.google.com/workspace/drive/api/guides/push).

### File-type and UI limitations

Glint's Drive files are blob Markdown files, not Google Workspace documents. Google documents that unanchored comments on Workspace documents appear in the “All Comments” view, while unanchored comments saved on PDFs are not shown in Drive's previewer. For custom anchored comments, Google Workspace editors treat the anchor as unanchored. The official documentation makes no corresponding Drive UI visibility promise for `text/markdown` blobs. Native storage through the API therefore does not establish a portable or even consistently Drive-visible annotation experience. See the [comment constraints](https://developers.google.com/workspace/drive/api/guides/manage-comments#comment-constraints).

## Options considered

| Model | Ownership and behavior | Result |
| --- | --- | --- |
| Native Drive comments only | Drive owns IDs, authors, permissions, replies, resolution, deletion, and polling. Non-Drive backends and standalone rendering lose discussions. Anchors are not stable Glint source locations. | Reject: violates file portability and creates a Drive-only product. |
| Markdown `comment` blocks only | The Markdown file owns the discussion. Existing renderer, authoring, backend permissions, and optimistic file concurrency apply uniformly. | **Choose: already implemented and backend-neutral.** |
| Both, shown as separate systems | Drive files have two unrelated discussion panes with different identities, permissions, state, and visibility. | Reject: duplicates the concept without solving interoperability. |
| Bidirectional synchronization | Requires persistent cross-system IDs, author impersonation or misattribution, anchor reconciliation, polling cursors, tombstones, conflict policy, and recovery from non-transactional dual writes. | Reject: there is no lossless mapping or user need that justifies it. |

## Behavioral contract

### Ownership and identity

1. Markdown bytes are authoritative for every Glint discussion, entry, flag, and summary.
2. The active storage backend owns file access and concurrency. Drive owns any native comments created outside Glint, but Glint neither claims nor mirrors them.
3. A fenced block has no hidden Drive ID and no persistent external mapping. Its source position is an ephemeral render/edit locator only.
4. Entry identity remains the source text written by the existing formatter: normalized adapter display name, minute timestamp, and message. This decision does not strengthen or reinterpret that identity.

### Minimal seam

No new seam is needed. Callers continue to use `StorageAdapter.read()` and `StorageAdapter.write()` for comment authoring and replies. Adding optional comment methods to `StorageAdapter`, a Drive-only comment adapter, mapping metadata, polling state, or a synchronization worker is out of scope and prohibited by this decision.

### Conflict, error, and security behavior

- A comment or reply is one ordinary version-checked file write. A stale Drive `modifiedTime` remains a file conflict; Glint must not silently overwrite newer bytes.
- Authentication, permission, network, parse, and write failures remain file-operation failures. The source must remain unchanged when the write fails, and the user must receive the existing actionable error path. There is no second remote write to partially succeed or compensate.
- Glint never renders Drive native comment HTML and therefore introduces no new HTML trust surface. Markdown comment bodies continue through the existing renderer and escaping rules.
- OAuth remains `drive.file`; the decision neither widens scopes nor stores access tokens, comment cursors, native comment content, or identity mappings.
- Native Drive comments, including resolved or deleted threads, do not affect file versions or Glint-rendered state and are not treated as change signals.

## Implementation disposition and acceptance criteria

Approval closes the design question without a new implementation ticket. Issue #27 already covers the actionable authoring behavior, and #20 remains only the SPA inbox epic.

The approved contract is satisfied while all of the following remain true:

1. The same fenced `comment` source renders through local, GitHub, Drive, and standalone render paths.
2. New discussions and replies modify only Markdown through the active adapter's version-checked file write.
3. Opening, focusing, rendering, or editing a Drive-backed file makes no Drive Comments API request and does not display or mutate native Drive comments.
4. The Drive adapter retains `drive.file`; no broader scope, webhook, polling cursor, mapping store, or new dependency is introduced.
5. A failed or conflicting comment write cannot produce a native comment or a partial cross-system state.
6. No follow-up duplicates the completed authoring work in #27.

A future native-comments proposal should be a new product decision, not an extension assumed by this design. It needs evidence that Drive-only, commenter-without-write access is required strongly enough to justify a separate, explicitly non-portable discussion surface. Even then, it should use Drive IDs directly and remain separate from Markdown rather than synchronize.

## Rejected follow-up work

- No native Drive-comment implementation ticket: the recommendation requires no code.
- No bidirectional sync spike: the documented identity, anchor, authorship, and delivery constraints already rule out a lossless minimal sync.
- No comment syntax changes, mapping markers, database, worker, webhook, or broader Drive scope.

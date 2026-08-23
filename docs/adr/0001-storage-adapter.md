# 0001 — Keep `StorageAdapter` file-focused

**Status:** Proposed

## Context

The SPA opens Local, Google Drive, and GitHub Sources through `StorageAdapter`. Each backend has different authentication, file identifiers, version tokens, and mutation requests, but the view/editor needs the same file behavior: authenticate, list, read, write with a version, create, and delete.

Potential additions—assets, conflict handling, search, and discussions—vary independently. Making each a `StorageAdapter` method would make callers learn provider-specific concepts and turn a deep file module into a shallow provider registry.

## Decision

Keep `StorageAdapter` as the file seam:

```ts
interface StorageAdapter {
  auth(): Promise<void>;
  identity(): { name: string };
  list(): Promise<FileMeta[]>;
  read(id: string): Promise<{ content: string; version: string }>;
  write(id: string, content: string, version: string): Promise<{ version: string }>;
  create(name: string, content: string): Promise<FileMeta>;
  delete(id: string): Promise<void>;
}
```

- **Conflicts** stay encoded in the read/write version contract (`ConflictError`). The adapter hides each backend's native token.
- **Search** remains an application concern over the currently listed Markdown files. A future source-side search capability requires two real adapters and a user-visible scale requirement before it becomes a seam.
- **Assets** are not Markdown-file behavior. Add a dedicated capability only when two Sources need user-visible asset operations.
- **Discussions** are backend-owned metadata, not Markdown. They are an optional, separate `DiscussionCapability`; Drive and its fake test adapter implement it, while Local/GitHub do not expose a discussion surface.

This preserves locality: backend request mapping stays inside its adapter, while unavailable optional behavior is explicit rather than spread as Drive checks through the SPA.

## Consequences

`StorageAdapter` remains a deep module: callers receive normalized file semantics without knowing GitHub SHA, Drive modified time, or local filesystem details. The cost is that a screen must feature-detect an optional capability; that is preferable to pretending every Source has every non-file feature.

No follow-up issue is recommended. The current Local, Drive, GitHub, and Fake adapters already demonstrate a real file seam; the new discussion capability is justified by distinct Drive and Fake implementations.

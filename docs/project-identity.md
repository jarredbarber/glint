# Glint: product identity

## Purpose

Glint helps technical writers keep Markdown portable while rendering it well. Math, diagrams, citations, wiki links, task markers, and in-document comments are content features: they belong in plain files and degrade gracefully outside Glint.

## Surfaces

| Surface | Input | Output | State |
| --- | --- | --- | --- |
| SPA | A local folder, Drive folder, or GitHub subtree | Browse, render, and edit Markdown in the browser | The chosen backend owns files and access control |
| Render | One file or standard input | One standalone HTML document or fragment | No remote state |

Both surfaces use the same Markdown pipeline. The SPA uses browser bundles; `glint render` uses the Node renderer to inline page assets and images.

## Boundaries

- Files are the source of truth. Glint does not own a database, account system, or credential store.
- Access is backend-native: local filesystem permission, Drive sharing, or GitHub token permissions.
- Edits use backend concurrency tokens and surface conflicts rather than silently overwriting newer content.
- Collaboration is asynchronous and file-based. Comment threads are `comment` fenced blocks in Markdown.
- The deployed app is static. A local HTTP server is only a development host for browser APIs and static assets.

## Product test

A feature belongs when it improves technical writing or preserves the portability of the source files. It does not belong merely because it recreates server infrastructure, a CMS, or live multi-user editing.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Glint is a self-contained Markdown server with server-side math rendering (KaTeX) and zero external API dependencies. It serves markdown files from a directory with live reload, inline editing, authentication, and interactive widgets.

## Commands

```bash
npm run dev           # Development with hot reload (tsx watch)
npm run build         # Full build: TypeScript compile + bundle clients
npm run bundle        # Rebuild only client bundles (faster)
npm test              # Run tests (Node.js native test runner)
npm start             # Run compiled server

glint serve [path]    # Start server on a directory
glint setup-auth      # Configure password protection
```

### Running a Single Test

```bash
tsx --test src/tests/parser.test.ts
```

## Architecture

### Tech Stack

- **Runtime:** Node.js (ESM)
- **Server:** Fastify with cookie auth
- **Markdown:** unified ecosystem (remark → rehype pipeline)
- **Editor:** CodeMirror 6 with vim mode
- **Build:** TypeScript (strict mode) + esbuild for client bundles
- **Config:** Zod schema validation over TOML (`glint.toml` or `.glint/config.toml`, parsed by `smol-toml`)

### Unified Pipeline

The markdown processing pipeline in `server.ts` follows a specific order:

```
remark-parse → remark-math → remark-gfm → remark-glint-widgets
  → remark-glint-citations → remark-wiki-link-glint → remark-mermaid-glint
  → remark-rehype(raw) → rehype-source-lines → rehype-raw
  → rehype-glint-image → rehype-glint-citations → rehype-katex
  → rehype-highlight → rehype-glint-code-blocks → rehype-glint-sections
  → rehype-slug → rehype-autolink-headings
  → rehype-extract-headings → rehype-stringify
```

**Plugin ordering matters:**
- `remark-math` runs early to protect math delimiters from other processing
- `rehype-source-lines` must run before `rehype-raw` to tag elements with line numbers
- Widgets emit MDAST `html` nodes which `rehype-raw` parses into HAST

### Key Design Decisions

1. **Source line mapping** — `data-source-line` attributes on DOM elements enable inline editing. The editor uses these to know which source lines to extract/replace.

2. **Widget system** — Tasks and comments are parsed during remark phase via `remark-glint-widgets.ts`, which dispatches to handlers in `src/widgets/`.

3. **Auxiliary file storage** — Images live in `{article}.md.assets/` folders alongside markdown files, keeping diffs clean.

4. **LRU caching** — Rendered HTML is cached by file path, invalidated on mtime change.

5. **Storage providers** — `StorageManager` supports multiple providers (Local, Git) with prefix-based mounts. Git provider auto-commits and syncs. Providers implement `StorageProvider` interface in `src/storage/types.ts`.

### Directory Layout

```
src/
├── cli.ts                    # Commander CLI entry point
├── server.ts                 # Main Fastify server + unified pipeline
├── renderer.ts               # HTML page template generator
├── config.ts                 # Zod schema for glint.toml / .glint/config.toml
├── renderer/                 # Modular page rendering (head, sidebar, scripts, etc.)
├── server/
│   ├── auth.ts              # bcrypt password auth + session cookies
│   ├── sse.ts               # Server-Sent Events for hot reload
│   └── routes/              # API endpoints (api.ts, auth.ts, git.ts, tasks.ts)
├── widgets/                  # Widget handlers (task.ts, comment.ts)
├── tasks/                    # Task scanning and parsing
├── client/                   # Frontend modules (bundled to assets/)
├── utils/                    # Shared utilities (fs-utils.ts, errors.ts)
└── [remark/rehype plugins]   # Custom markdown processing plugins
```

### REST API

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/source/*` | GET | Fetch raw markdown + content hash |
| `/api/save` | POST | Save edited content (optimistic locking via hash) |
| `/api/upload` | POST | Upload image to `.assets/` folder |
| `/api/tasks` | GET | Aggregated task list from all files |
| `/tasks` | GET | Task dashboard page |
| `/api/journal/*` | GET/POST | Journal entries |
| `/api/documents/*` | GET/POST | Document CRUD |
| `/api/git/*` | POST | Git operations (commit, sync) |
| `/f/*` | GET | File serving (`?raw=true` for raw markdown) |

## Widget System

### Task Widget

Syntax: `- [state] description (metadata)`

States: `[ ]` open, `[x]` done, `[/]` progress, `[w]` waiting, `[b]` blocked, `[c]` cancelled

Metadata: `#priority`, `@assignee`, `due:YYYY-MM-DD`, `scheduled:YYYY-MM-DD`, `created:YYYY-MM-DD`, `completed:YYYY-MM-DD`

### Comment Widget

Syntax: ` ```comment ` fenced code block with `author@YYYY-MM-DD:HH:MM message` entries

Flags: `#resolved`, `#important`, `summary: Title`

### Adding a New Widget

1. Create `src/widgets/{name}.ts` implementing `WidgetHandler`
2. Register in `src/widgets/index.ts`
3. Handle client-side interactions in `src/client/` module

## Issue Tracking

This project uses **bd (beads)** for issue tracking. Key commands:

```bash
bd ready              # Find unblocked work (main source of tasks)
bd create "Title" --type task --priority 2   # Create issue (priority: 0-4)
bd update <id> --status in_progress          # Claim work
bd close <id>         # Complete work
bd sync               # Sync with git (run at session end)
```

## Citations

When adding citations to a Glint document, use inline `[[#ref:id]]` syntax referencing items in a `## References` section. Format: `- [ref:id] "Title" Author (Year) URL`

# Glint Agent Reference

> Agent-facing documentation for AI assistants working on the Glint codebase.

---

## Project Overview

**Glint** is a self-contained Markdown server with server-side math rendering (KaTeX) and zero external API dependencies. It serves markdown files from a directory with live reload, inline editing, image management, authentication, and shareable links.

**Current Version:** V3+ — Widgets (Tasks/Comments), Citations, Auth, Share Links, Task Dashboard

---

## Architecture

### Stack

- **Runtime:** Node.js (ESM)
- **Server:** Fastify with cookie auth
- **Markdown:** unified ecosystem (remark → rehype)
- **Editor:** CodeMirror 6 with vim mode
- **Build:** TypeScript + esbuild (for client bundles)
- **Config:** `.glint/config.json` + Zod schema validation

### Key Design Decisions

1. **Server-side math rendering** — KaTeX runs at render time via `remark-math` + `rehype-katex`. Fonts/CSS bundled locally in `assets/katex/`.

2. **Hot reload via SSE** — File watcher triggers SSE events to reload the page. See `src/server/sse.ts`.

3. **Source line mapping** — The `data-source-line` attribute on DOM elements enables inline editing. Critical for the editor to know which lines to extract/replace. Handled by `rehype-source-lines.ts`.

4. **Auxiliary file storage** — Images live in `{article}.md.assets/` folders, not inline data URLs. This keeps markdown files clean for git diffs.

5. **LRU caching** — Rendered HTML is cached keyed by file path, invalidated on mtime change.

6. **Widget System** — Embedded widgets (Tasks, Comments) are parsed during the remark phase and transformed into rich HTML via `remark-glint-widgets.ts`.

7. **Authentication** — Optional bcrypt password auth with signed session cookies. Configured in `.glint/config.json`.

8. **Shareable Links** — Create time-limited, access-controlled share links stored in `.glint/shares.json`.

---

## Directory Structure

```
glint/
├── src/
│   ├── cli.ts                 # Commander CLI entry point
│   ├── server.ts              # Main Fastify server, routing, unified pipeline
│   ├── renderer.ts            # HTML page template (head, sidebar, scripts)
│   ├── markdown.ts            # Frontmatter parsing, H1 extraction
│   ├── config.ts              # Zod schema for config
│   ├── filetree.ts            # Sidebar file tree builder
│   ├── remark-glint-widgets.ts  # Widget plugin dispatcher
│   ├── widgets/
│   │   ├── index.ts          # Exports all registered handlers
│   │   ├── types.ts          # WidgetHandler interface
│   │   ├── task.ts           # Task list item widget
│   │   └── comment.ts        # Comment thread widget
│   ├── server/
│   │   ├── auth.ts           # Authentication logic, session management
│   │   ├── share.ts          # ShareService for shareable links
│   │   ├── sse.ts            # Server-Sent Events for hot reload
│   │   └── routes/
│   │       ├── api.ts        # REST endpoints: /api/save, /api/upload, /api/source/*
│   │       ├── auth.ts       # Login/logout routes
│   │       ├── git.ts        # Git integration endpoints
│   │       └── tasks.ts      # Task dashboard API
│   ├── tasks/
│   │   ├── scanner.ts        # Scans all .md files for tasks
│   │   ├── parser.ts         # Parses task lines
│   │   └── types.ts          # Task types
│   ├── client/
│   │   ├── editor.ts          # GlintEditor class (CodeMirror wrapper)
│   │   ├── editor-integration.ts  # Editing coordinator
│   │   ├── editor-icons.ts    # Edit icon injection
│   │   ├── editor-sessions.ts # Section/preamble/code editing
│   │   ├── editor-tasks.ts    # Task state toggling
│   │   ├── editor-comments.ts # Comment reply/resolve
│   │   ├── editor-shortcuts.ts # Keyboard shortcuts
│   │   ├── clipboard.ts       # Clipboard image detection
│   │   ├── permissions.ts     # Client-side access checks
│   │   ├── router.ts          # Client-side SPA navigation
│   │   ├── upload.ts          # Image paste/upload handling
│   │   ├── image-resize.ts    # Drag-to-resize images
│   │   ├── drag-reorder.ts    # Section reordering
│   │   ├── scroll-utils.ts    # Scroll position preservation
│   │   ├── share.ts           # Share modal interactions
│   │   ├── outline.ts         # Right-side TOC interactions
│   │   ├── citations.ts       # Citation hover cards
│   │   └── task-view.ts       # Task dashboard client
│   ├── utils/
│   │   ├── fs-utils.ts        # Secure path resolution
│   │   └── errors.ts          # Typed error classes (ForbiddenError, NotFoundError)
│   └── [rehype/remark plugins]
│       ├── rehype-source-lines.ts     # Add data-source-line attributes
│       ├── rehype-glint-image.ts      # Image width syntax, figure/caption
│       ├── rehype-extract-headings.ts # Extract outline for sidebar
│       ├── rehype-glint-citations.ts  # Citation rendering
│       ├── remark-glint-citations.ts  # Citation parsing
│       ├── remark-mermaid-glint.ts    # Mermaid diagram support
│       └── remark-wiki-link-glint.ts  # [[wiki-link]] syntax
├── assets/
│   ├── katex/                 # Bundled KaTeX fonts + CSS
│   ├── themes/                # CSS theme files (6 themes)
│   ├── layout.css             # Main layout styles
│   ├── highlight.css          # Code syntax highlighting
│   └── *.bundle.js            # Compiled client bundles
├── docs/
│   ├── CODE_REVIEW.md         # Current code review
│   ├── SPEC.md                # V1 design spec
│   ├── SPEC_V2.md             # V2 editing spec
│   └── SPEC_V3.md             # V3 widget spec
└── .glint/
    ├── config.json            # Per-project configuration (preferred)
    └── shares.json            # Active share links
```

---

## Core Concepts

### Unified Pipeline

The markdown processing pipeline in `server.ts`:

```
remark-parse → remark-math → remark-gfm → remark-glint-widgets
  → remark-glint-citations → remark-wiki-link-glint → remark-mermaid-glint
  → remark-rehype(raw) → rehype-source-lines → rehype-raw
  → rehype-glint-image → rehype-glint-citations → rehype-katex
  → rehype-highlight → rehype-slug → rehype-autolink-headings
  → rehype-extract-headings → rehype-stringify
```

**Plugin Ordering Matters:**

- `remark-math` runs early to protect math delimiters
- `remark-glint-widgets` runs in remark phase (before remark-rehype)
- `rehype-source-lines` must run before `rehype-raw` to tag elements
- Widgets emit MDAST `html` nodes which `rehype-raw` parses into HAST
- Citations processed in both remark (parsing) and rehype (rendering) phases

### Widget System

Widgets are embedded markdown constructs that render as rich, interactive UI.

#### Adding a New Widget

1. Create `src/widgets/{name}.ts` implementing `WidgetHandler`
2. Register in `src/widgets/index.ts`
3. Handle client-side interactions in appropriate `src/client/` module

#### Task Widget

Syntax: `- [state] description (metadata)`

States: `[ ]` open, `[x]` done, `[/]` progress, `[w]` waiting, `[b]` blocked, `[c]` cancelled

Metadata: `#priority`, `@assignee`, `due:YYYY-MM-DD`, `scheduled:YYYY-MM-DD`, `created:YYYY-MM-DD`, `completed:YYYY-MM-DD`

Example:

```markdown
- [x] Review PR #42 (due:2026-02-05 @jarred #urgent completed:2026-01-13)
- [/] Refactor API (@alice due:2026-03-01)
```

#### Comment Widget

Syntax: ` ```comment ` fenced code block

Features:

- `#resolved` / `#important` flags
- `summary: Title` custom header
- `author@YYYY-MM-DD:HH:MM message` format
- Multi-line markdown in message bodies

Example:

````markdown
```comment
summary: Design discussion
#important
jarred@2026-01-11:14:00 Initial proposal looks good.

clanker@2026-01-11:14:30 I have some concerns:
- Performance impact
- Memory usage
```
````

### Source Line Mapping

The editor relies on `data-source-line` attributes to:

1. Identify which DOM elements belong to a section
2. Fetch the corresponding source lines via `/api/source/*`
3. Replace sections after editing via `/api/save`

**Key files:** `rehype-source-lines.ts`, `client/editor-sessions.ts`

### REST API

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/source/*` | GET | Fetch raw markdown + content hash |
| `/api/save` | POST | Save edited content (with optimistic locking via hash) |
| `/api/upload` | POST | Upload image file to `.assets/` folder |
| `/api/theme` | POST | Update theme in config |
| `/api/auth/login` | GET/POST | Login page and authentication |
| `/api/auth/logout` | POST | Clear session |
| `/api/share` | GET/POST/DELETE | Manage shareable links |
| `/api/shares/:filePath` | GET | Get shares for a file |
| `/api/git/status` | GET | Git repository status |
| `/api/git/commit` | POST | Commit changes |
| `/api/tasks` | GET | Aggregated task list from all files |
| `/tasks` | GET | Task dashboard page |

### Image Storage Pattern

Images are stored alongside markdown files:

```
docs/my-article.md
docs/my-article.md.assets/
    abc123.png
    def456.jpg
```

Referenced as: `![caption](/api/asset/resolve/docs/my-article.md.assets/abc123.png)`

---

## Configuration

Config location: `.glint/config.json` (preferred) or `glint.json` (legacy, auto-migrated)

```json
{
    "port": 3000,
    "host": "0.0.0.0",
    "theme": "nord",
    "baseFile": "README.md",
    "latex-macros": {
        "R": "\\mathbb{R}",
        "N": "\\mathbb{N}"
    },
    "auth": {
        "enabled": true,
        "passwordHash": "$2b$10$...",
        "sessionSecret": "your-secret-key",
        "public": [
            { "path": "docs/public/**", "access": "view" },
            { "path": "README.md", "access": "view" }
        ]
    }
}
```

Available themes: `default`, `everforest-dark`, `nord`, `gruvbox-dark`, `catppuccin-mocha`, `solarized-light`

Changes to config trigger automatic reload.

---

## Development Commands

```bash
npm run dev         # Hot-reload dev server (tsx watch)
npm run build       # TypeScript compile + bundle clients
npm run bundle      # Just rebuild client bundles
npm start           # Run compiled server
```

Client bundles built with esbuild:

- `editor.bundle.js` — CodeMirror wrapper
- `router.bundle.js` — SPA navigation
- `upload.bundle.js` — Image handling
- `editor-integration.bundle.js` — Editing coordination
- `image-resize.bundle.js` — Drag resize
- `drag-reorder.bundle.js` — Section reordering
- `share.bundle.js` — Share modal
- `outline.bundle.js` — Right-side TOC
- `citations.bundle.js` — Citation hover
- `task-view.bundle.js` — Task dashboard

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `c` | Insert comment block after hovered element |
| `e` | Open inline editor for hovered section |
| `Cmd+K` / `Ctrl+K` | Open command palette |

---

## Important Patterns

### Adding a New Rehype Plugin

1. Create `src/rehype-{name}.ts`
2. Import and `.use()` in `server.ts` `createProcessor()`
3. Consider order relative to `rehype-source-lines` and `rehype-raw`

### Adding a New API Endpoint

1. Add route in appropriate `src/server/routes/*.ts` file
2. Use `resolveContentPath()` for secure file access
3. Use typed `ForbiddenError` / `NotFoundError` for error handling
4. Check `request.isAuthenticated()` and `request.getAccess()` for auth

### Modifying the Editor

1. `editor.ts` — Core CodeMirror configuration
2. `editor-sessions.ts` — Section editing logic
3. `editor-integration.ts` — Module coordination
4. Remember to rebuild: `npm run bundle`

---

## Testing

Currently no automated tests. Manual verification:

1. Run `npm run dev`
2. Open <http://localhost:3000>
3. Test editing, image upload, theme switching
4. Test task state toggling and comment Reply/Resolve
5. Test auth flow (if enabled)
6. Test share link creation and access

---

## Known Issues & Technical Debt

> See `docs/CODE_REVIEW.md` for the full code review.

### Priority Items

- **`renderer.ts` is 756 lines** — Should be split into focused modules
- **Command palette inline** — Should be extracted to client bundle

### Minor Cleanup

- `comment.ts` manually defines `CONTINUE` instead of importing
- `tasks/scanner.ts` has unused import of `resolveContentPath`

### Missing Features

- No full-text search
- Wiki links don't validate target existence
- No print/export stylesheet
- No automated tests

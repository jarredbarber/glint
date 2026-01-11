# Glint Agent Reference

> Agent-facing documentation for AI assistants working on the Glint codebase.

---

## Project Overview

**Glint** is a self-contained Markdown server with server-side math rendering (KaTeX) and zero external API dependencies. It serves markdown files from a directory with live reload, inline editing, and image management.

**Current Version:** V3 (Widgets complete) — Tasks and Comments widgets with full client-side interactivity.

---

## Architecture

### Stack

- **Runtime:** Node.js (ESM)
- **Server:** Fastify
- **Markdown:** unified ecosystem (remark → rehype)
- **Editor:** CodeMirror 6
- **Build:** TypeScript + esbuild (for client bundles)
- **Config:** `glint.json` + Zod schema validation

### Key Design Decisions

1. **Server-side math rendering** — KaTeX runs at render time, not in the browser. Fonts/CSS bundled locally in `assets/katex/`.

2. **Hot reload via SSE** — File watcher triggers SSE events to reload the page. See `src/server/sse.ts`.

3. **Source line mapping** — The `data-source-line` attribute on DOM elements enables inline editing. Critical for the editor to know which lines to extract/replace. Handled by `rehype-source-lines.ts`.

4. **Auxiliary file storage** — Images live in `{article}.assets/` folders, not inline data URLs. This keeps markdown files clean for git diffs.

5. **LRU caching** — Rendered HTML is cached keyed by file path, invalidated on mtime change.

6. **Widget System** — Embedded widgets (Tasks, Comments) are parsed during the remark phase and transformed into rich HTML via `remark-glint-widgets.ts`.

---

## Directory Structure

```
glint/
├── src/
│   ├── cli.ts                 # Commander CLI entry point
│   ├── server.ts              # Main Fastify server, routing, unified pipeline
│   ├── renderer.ts            # HTML page template (head, sidebar, scripts)
│   ├── markdown.ts            # Frontmatter parsing, H1 extraction
│   ├── config.ts              # Zod schema for glint.json
│   ├── filetree.ts            # Sidebar file tree builder
│   ├── remark-glint-widgets.ts  # Widget plugin dispatcher
│   ├── widgets/
│   │   ├── index.ts          # Exports all registered handlers
│   │   ├── types.ts          # WidgetHandler interface
│   │   ├── task.ts           # Task list item widget
│   │   └── comment.ts        # Comment thread widget
│   ├── server/
│   │   ├── sse.ts             # Server-Sent Events for hot reload
│   │   └── routes/
│   │       └── api.ts         # REST endpoints: /api/save, /api/upload, /api/source/*
│   ├── client/
│   │   ├── editor.ts          # GlintEditor class (CodeMirror wrapper)
│   │   ├── editor-integration.ts  # Inline section editing UI, widget interactions
│   │   ├── router.ts          # Client-side SPA navigation
│   │   ├── upload.ts          # Image paste/upload handling
│   │   ├── image-resize.ts    # Drag-to-resize images
│   │   └── scroll-utils.ts    # Scroll position preservation
│   ├── utils/
│   │   └── fs-utils.ts        # Secure path resolution
│   └── [rehype/remark plugins]
│       ├── rehype-glint-katex.ts      # Math: $ / $$ / $$$ syntax → KaTeX
│       ├── rehype-source-lines.ts     # Add data-source-line attributes
│       ├── rehype-glint-image.ts      # Image width syntax, figure/caption
│       ├── rehype-extract-headings.ts # Extract outline for sidebar
│       ├── remark-mermaid-glint.ts    # Mermaid diagram support
│       └── remark-wiki-link-glint.ts  # [[wiki-link]] syntax
├── assets/
│   ├── katex/                 # Bundled KaTeX fonts + CSS
│   ├── themes/                # CSS theme files
│   ├── layout.css             # Main layout styles
│   ├── highlight.css          # Code syntax highlighting
│   └── *.bundle.js            # Compiled client bundles
├── docs/
│   ├── SPEC.md                # V1 design spec
│   ├── SPEC_V2.md             # V2 editing spec
│   ├── SPEC_V3_inline.md      # V3 widget spec
│   └── TASKS_V3.md            # V3 implementation tasks
└── glint.json                 # Per-project configuration
```

---

## Core Concepts

### Unified Pipeline

The markdown processing pipeline in `server.ts`:

```
remark-parse → remark-gfm → remark-glint-widgets → remark-wiki-link-glint
  → remark-mermaid-glint → remark-rehype(raw) → rehype-raw
  → rehype-source-lines → rehype-glint-image → rehype-glint-katex
  → rehype-highlight → rehype-slug → rehype-autolink-headings
  → rehype-extract-headings → rehype-stringify
```

**Plugin Ordering Matters:**

- `remark-glint-widgets` runs early in remark phase (before remark-rehype)
- `rehype-source-lines` must run before transformations that add/remove nodes
- Widgets emit MDAST `html` nodes which `rehype-raw` parses into HAST

### Widget System

Widgets are embedded markdown constructs that render as rich, interactive UI.

#### Adding a New Widget

1. Create `src/widgets/{name}.ts` implementing `WidgetHandler`
2. Register in `src/widgets/index.ts`
3. Handle client-side interactions in `src/client/editor-integration.ts`

#### Task Widget

Syntax: `- [state] description (metadata)`

States: `[ ]` open, `[x]` done, `[/]` progress, `[w]` waiting, `[b]` blocked

Example:

```markdown
- [ ] Review PR #42 (due:2026-02-05 @jarred #urgent)
- [x] Submit expenses (completed:2026-01-11)
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

**Key files:** `rehype-source-lines.ts`, `editor-integration.ts`

### REST API

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/source/*` | GET | Fetch raw markdown + content hash |
| `/api/save` | POST | Save edited content (with optimistic locking via hash) |
| `/api/upload` | POST | Upload image file to `.assets/` folder |
| `/api/theme` | POST | Update theme in glint.json |

### Image Storage Pattern

Images are stored alongside markdown files:

```
docs/my-article.md
docs/my-article.md.assets/
    abc123.png
    def456.jpg
```

Referenced as: `![caption](/content/docs/my-article.md.assets/abc123.png)`

---

## Configuration

`glint.json` schema:

```json
{
    "port": 3000,
    "host": "0.0.0.0",
    "theme": "nord",
    "baseFile": "README.md",
    "latex-macros": {
        "R": "\\mathbb{R}",
        "N": "\\mathbb{N}"
    }
}
```

Changes to `glint.json` trigger automatic reload.

---

## Development Commands

```bash
npm run dev         # Hot-reload dev server (tsx watch)
npm run build       # TypeScript compile + bundle clients
npm run bundle      # Just rebuild client bundles
npm start           # Run compiled server
```

Client bundles are built with esbuild and output to `assets/*.bundle.js`.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `c` | Insert comment block after hovered element |
| `e` | Open inline editor for hovered section |

---

## Important Patterns

### Adding a New Rehype Plugin

1. Create `src/rehype-{name}.ts`
2. Import and `.use()` in `server.ts` `createProcessor()`
3. Consider order relative to `rehype-source-lines`

### Adding a New API Endpoint

1. Add route in `src/server/routes/api.ts`
2. Use `resolveContentPath()` for secure file access
3. Handle `FORBIDDEN` and `NOT_FOUND` error messages

### Modifying the Editor

1. `editor.ts` — Core CodeMirror configuration
2. `editor-integration.ts` — Section editing UI, icon injection
3. Remember to rebuild: `npm run bundle:editor`

---

## Testing

Currently no automated tests. Manual verification:

1. Run `npm run dev`
2. Open <http://localhost:3000>
3. Test editing, image upload, theme switching
4. Test task state toggling and comment Reply/Resolve

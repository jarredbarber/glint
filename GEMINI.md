# Glint Agent Reference

> Agent-facing documentation for AI assistants working on the Glint codebase.

---

## Project Overview

**Glint** is a self-contained Markdown server with server-side math rendering (KaTeX) and zero external API dependencies. It serves markdown files from a directory with live reload, inline editing, and image management.

**Current Version:** V2 (Editing complete) — V3 (Commenting, multi-user) not yet started.

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
│   ├── server/
│   │   ├── sse.ts             # Server-Sent Events for hot reload
│   │   └── routes/
│   │       └── api.ts         # REST endpoints: /api/save, /api/upload, /api/source/*
│   ├── client/
│   │   ├── editor.ts          # GlintEditor class (CodeMirror wrapper)
│   │   ├── editor-integration.ts  # Inline section editing UI
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
│       ├── remark-wiki-link-glint.ts  # [[wiki-link]] syntax
│       └── remark-slash-checkbox.ts   # /todo checkbox syntax
├── assets/
│   ├── katex/                 # Bundled KaTeX fonts + CSS
│   ├── themes/                # CSS theme files
│   ├── layout.css             # Main layout styles
│   ├── highlight.css          # Code syntax highlighting
│   └── *.bundle.js            # Compiled client bundles
├── docs/
│   ├── SPEC.md                # V1 design spec
│   ├── SPEC_V2.md             # V2 editing spec
│   └── SPEC_V3.md             # V3 roadmap (placeholder)
└── glint.json                 # Per-project configuration
```

---

## Core Concepts

### Unified Pipeline

The markdown processing pipeline in `server.ts`:

```
remark-parse → remark-gfm → remark-slash-checkbox → remark-wiki-link-glint
  → remark-mermaid-glint → remark-rehype(raw) → rehype-raw
  → rehype-source-lines → rehype-glint-image → rehype-glint-katex
  → rehype-highlight → rehype-slug → rehype-autolink-headings
  → rehype-extract-headings → rehype-stringify
```

**Plugin Ordering Matters:**

- `rehype-source-lines` must run early (before transformations that add/remove nodes)
- `rehype-glint-image` processes width syntax before general rendering
- `rehype-glint-katex` runs after raw HTML is unescaped

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

## V3 Roadmap (Not Yet Implemented)

- User accounts and authentication
- Projects / workspaces
- **Commenting system** (Google Docs style)
- Real-time collaboration

---

## Testing

Currently no automated tests. Manual verification:

1. Run `npm run dev`
2. Open <http://localhost:3000>
3. Test editing, image upload, theme switching

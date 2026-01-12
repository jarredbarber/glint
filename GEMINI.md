# Glint Agent Reference

> Agent-facing documentation for AI assistants working on the Glint codebase.

## Issue Tracking

This project uses **bd (beads)** for issue tracking.
Run `bd prime` for workflow context, or install hooks (`bd hooks install`) for auto-injection.

**Quick reference:**

- `bd ready` - Find unblocked work
- `bd create "Title" --type task --priority 2` - Create issue
- `bd close <id>` - Complete work
- `bd sync` - Sync with git (run at session end)

## Core Rules

- Track strategic work in beads (multi-session, dependencies, discovered work)
- Use `bd create` for issues, TodoWrite for simple single-session execution
- When in doubt, prefer bd—persistence you don't need beats lost context
- Git workflow: hooks auto-sync, run `bd sync` at session end
- Session management: check `bd ready` for available work

## Essential Commands

### Finding Work

- IMPORTANT: `bd ready` - Show issues ready to work (no blockers). This is your main source of work.
- `bd list --status=open` - All open issues
- `bd list --status=in_progress` - Your active work
- `bd show <id>` - Detailed issue view with dependencies

### Creating & Updating

- `bd create --title="..." --type=task|bug|feature --priority=2` - New issue
  - Priority: 0-4 or P0-P4 (0=critical, 2=medium, 4=backlog). NOT "high"/"medium"/"low"
- `bd update <id> --status=in_progress` - Claim work
- `bd update <id> --assignee=username` - Assign to someone
- `bd close <id>` - Mark complete
- `bd close <id1> <id2> ...` - Close multiple issues at once (more efficient)
- `bd close <id> --reason="explanation"` - Close with reason
- **Tip**: When creating multiple issues/tasks/epics, use parallel subagents for efficiency

### Dependencies & Blocking

- `bd dep add <issue> <depends-on>` - Add dependency (issue depends on depends-on)
- `bd blocked` - Show all blocked issues
- `bd show <id>` - See what's blocking/blocked by this issue

### Sync & Collaboration

- `bd sync` - Sync with git remote (run at session end)
- `bd sync --status` - Check sync status without syncing

### Project Health

- `bd stats` - Project statistics (open/closed/blocked counts)
- `bd doctor` - Check for issues (sync problems, missing hooks)

## Common Workflows

**Starting work:**

```bash
bd ready           # Find available work
bd show <id>       # Review issue details
bd update <id> --status=in_progress  # Claim it
```

**Completing work:**

```bash
bd close <id1> <id2> ...    # Close all completed issues at once
bd sync                     # Push to remote
```

**Creating dependent work:**

```bash
# Run bd create commands in parallel (use subagents for many items)
bd create --title="Implement feature X" --type=feature
bd create --title="Write tests for X" --type=task
bd dep add beads-yyy beads-xxx  # Tests depend on Feature (Feature blocks tests)
```

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

---

## Known Issues & Dead Code

> See `docs/CODE_REVIEW.md` for the full code review.

### Dead Code (Safe to Delete)

| File | Reason |
|------|--------|
| `src/rehype-glint-katex.ts` | Unused — standard `rehype-katex` is used instead |
| `src/rehype-math-enumerate.ts` | Never integrated into pipeline |
| `src/remark-slash-checkbox.ts` | Never integrated into pipeline |

### Large Files to Refactor

- **`src/client/editor-integration.ts`** (1198 lines) — Should be split into focused modules for edit icons, section editing, task interactions, comment actions, keyboard shortcuts, and line tracker.

### Config Inconsistencies

- Default theme is `'nord'` in `config.ts` but `'everforest-dark'` in `renderer.ts` fallback
- Config is loaded separately in `server.ts` and `api.ts` (not shared)

### Missing Features

- No full-text search
- No mobile-responsive sidebar
- Wiki links don't validate target existence
- No print/export stylesheet
- Mermaid colors are hardcoded (not theme-aware)

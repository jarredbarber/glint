---
title: Glint V2 Implementation Tasks
date: 2026-01-09
---

# Glint V2 — Task Breakdown

Tasks organized by phase. Complete phases in order. Within each phase, tasks can be parallelized where noted.

**AGENT INSTRUCTIONS**: Read @SPEC.md and @SPEC_V2.md for context. As you work on your assigned tasks, break them down into sub-tasks and add them as sub-bullets in this file, then check them off as you work. **IMPORTANT**: This is a typescript project! Code goes in src/!

---

## Phase 1: API Foundation

Before any editing features, we need a REST API layer.

**Note:** Section editing uses client-side splicing—client fetches full file, edits a portion, then saves full file back. Simple and sufficient for single-user.

- [x] **1.1** Create `POST /api/save` endpoint
  - Accepts `{ path: string, content: string, hash?: string }`
  - Writes content to file, returns `{ success: true, hash: string }`
  - Validate path is within content directory (security)
  - Optional: If `hash` provided, reject if file changed (optimistic locking)

- [x] **1.2** Create `POST /api/upload` endpoint
  - Accepts multipart form with image file + `articlePath` parameter
  - Saves to `{article}.assets/` folder with `{timestamp}-{nanoid}.{ext}` naming
  - Returns `{ url: string }` for the saved image

- [x] **1.3** Create `GET /api/source/:path` endpoint
  - Returns `{ content: string, hash: string }` (raw markdown + hash for locking)
  - Needed for editor to load content

---

## Phase 2: Editor Widget

Build the CodeMirror-based editing component.

- [x] **2.1** Install CodeMirror 6 dependencies
  - [x] Add `esbuild` for client-side bundling
  - [x] Add `@codemirror/state`, `@codemirror/view`, `@codemirror/lang-markdown`, `@codemirror/commands`, `@codemirror/language`
  - [x] Add `@codemirror/theme-one-dark`
- [x] **2.2** Create `GlintEditor` wrapper class
  - [x] Implement `create()`, `getValue()`, `destroy()`, `setValue()`
  - [x] Add abstraction layer to separate from CM6
- [x] **2.3** Create editor theme matching Glint themes
  - [x] Map CSS variables (`--bg-color`, `--text-color`, etc.) to CM6 theme
- [x] **2.4** Add Save/Cancel button bar
- [x] **2.5** [P2] Add markdown syntax highlighting
- [x] **2.6** [P2] Add Vim mode support
  - [x] Install `@replit/codemirror-vim`
  - [x] Add status bar for command output
  - [x] Toggle via options

---

## Phase 3: Content View Integration

Connect editor to the rendered page.

- [x] **3.1** Track source line numbers through markdown processor [x]
  - [x] Modify remark/rehype pipeline to annotate HTML with `data-source-line` attributes [x]
- [x] **3.2** Implement section-based editing logic [x]
  - [x] Click pencil icon opens edit mode for that heading's section [x]
  - [x] Calculate range based on headings [x]
- [x] **3.3** Add pencil icon on heading hover [x]
- [ ] **3.4** [P2] Implement "View Only" mode toggle
- [x] **3.5** Integrate save → re-render flow [x]
  - [x] After save, re-render to reflect changes [x]

---

## Phase 4: Image Upload

Enable pasting/uploading images.

- [x] **4.1** Implement context menu for paste
  - Right-click in content area shows "Paste Image" option
  - Only visible when clipboard contains image data

- [x] **4.2** Handle clipboard image extraction
  - Use Clipboard API to read image from clipboard
  - Convert to Blob for upload

- [x] **4.3** Upload image and insert into document
  - Call `POST /api/upload`
  - Insert `<img>` tag at end of document (simplest insertion point)
  - Default width to ~33% of content area

- [x] **4.4** Create `.assets/` folder automatically
  - When uploading first image for a document
  - Naming: `{article-name}.assets/`

---

## Phase 5: Image Display & Resize

Enhance image rendering with resize handles.

- [ ] **5.1** Add resize handles overlay on image hover
  - Corner handles for proportional resize
  - Visual feedback during drag

- [ ] **5.2** Update markdown source on resize
  - Modify `width` attribute in source `<img>` tag
  - Save changes via API

- [ ] **5.3** [P2] Support alignment via right-click menu
  - Options: Left, Center, Right
  - Updates `style` attribute in source

- [ ] **5.4** [P2] Add caption support
  - `<figure>` + `<figcaption>` wrapper
  - Editable caption text

---

## Phase 6: File Management (P2)

Sidebar file operations.

- [ ] **6.1** Add "New File" button to sidebar
  - Prompts for filename
  - Creates empty `.md` file

- [ ] **6.2** Add "New Folder" button to sidebar
  - Prompts for folder name
  - Creates directory

- [ ] **6.3** Add delete option (right-click menu)
  - Deletes file/folder after confirmation

- [ ] **6.4** [P2] Drag-and-drop file/folder reordering

---

## Deferred (V3+)

- [x] Vim/neovim mode for editor (Added in Phase 2) [x]
- Preview hooks (hover equation → rendered preview)
- Git integration (pull/commit/push)
- Server-side image resizing
- Image deletion with file cleanup
- Multi-user concurrent editing

---

## Suggested Implementation Order

1. **Phase 1** → Phase 2 → Phase 3 (core editing loop)
2. **Phase 4** (images are high priority)
3. **Phase 5** (polish images)
4. **Phase 6** (P2, can defer)

---

## Polish tasks

### Images

- Drop the right-click context menu for image pasting.
- Images should be centered by default
- Image filename datestamps are weird e.g. `1768013482693-yjuvyb.png`. Maybe just a nanoid?

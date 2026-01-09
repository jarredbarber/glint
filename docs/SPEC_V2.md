---
title: Glint v2 spec
author: Jarred Barber and Claude
date: 2026-01-09
---

NOTE: In this document, i'll use [Pn] or [D] for priority. [P2] features are nice to have but not critical. [D] are important features that will be deferred to a future version but are important to consider for architecture design. Default is [P1]

The theme for v2 will be editing.

Two big features:

1. In-browser editing widget
2. Adding images

---

## Editing feature

Subcomponents: The widget, the content window integration, and file management.

### The widget

We will use [CodeMirror 6](https://codemirror.net/) as the editing widget. It provides markdown syntax highlighting, vim mode support (for future use), and a decorations API for collapsing data URLs. [P2] We should create an abstraction layer to avoid over-coupling to CodeMirror, in case we want to explore a custom editor in the future.

**Requirements:**

- [P0] Text box with save/cancel buttons. Should use the theme but be visually distinct.
- [P1] Markdown syntax highlighting
- [P2] LaTeX section highlighting (`$/$$/$$$`) and code block language highlighting
- [P2] Collapse long data URLs visually (e.g., `data:image/jpeg:...` → `<image/jpeg data url>`)
- [D] Vim/neovim mode (important, but want to get it right—defer for now)
- [D] Preview hooks (e.g., hover over equation to preview rendered output)

### Integration with glint content view

**Primary workflow:**

1. User views a file in glint
2. User highlights lines of content they want to edit
3. User invokes 'edit' mode via hotkey (e.g., 'e') or pencil icon
4. That section is replaced with the editor widget, loaded with the source markdown for those lines
5. User edits and clicks Save (or Cancel / ESC to discard)
6. Widget closes and is replaced with the newly rendered markdown

**Additional UX:**

- Pencil icon (✏️) appears on hover next to each heading—clicking opens edit mode for that section
- [P1] "View only" mode toggle that disables all editing functionality
- Technical note: Need to track line numbers through the markdown processor to map rendered HTML back to source lines

### File management

- [P2] User can add/remove files from the file drawer
- [P2] User can create new folders
- [P2] User can move files between folders
- [D] Git operations (pull/commit/push)—defer, but we'll implement this ourselves (not via configurable command)

---

## Adding images

Images are a big drawback of markdown notes since they live outside the file.

### Storage

**Decision:** Use filesystem storage (not inline data URLs).

**Rationale:**

- Data URLs bloat files and break `git diff`
- External editors (VS Code, nvim) already understand relative paths
- User can manage images with normal file tools

**Folder structure:**

```
docs/
  my-article.md
  my-article.assets/
    image-001.png
    screenshot-2026-01-09.png
```

**Naming convention:** Auto-generated names use `{timestamp}-{nanoid}.{ext}`. Preserve original filename for drag-drop uploads if user prefers.

### Display widget

We already display images; we need to ensure robust handling of:

- [P1] Image resizing
- [P1] Captions
- [P1] Alignment (center/left/right)
- [P2] Text wrapping around images

**Metadata storage:** Use inline HTML for size/alignment (e.g., `<img src="image.png" width="300" style="display:block; margin:auto">`). This is portable and works in any markdown viewer.

### Upload workflow

#### [P0] Upload an image via paste (context menu)

The most important workflow—users commonly paste screenshots or images from clipboard.

**UX flow:**

1. User right-clicks the content window
2. Selects "Paste image" from context menu
3. Image is saved to `{article}.assets/` folder
4. `<img>` tag is inserted into the markdown at appropriate position
5. For large images, default to ~1/3 page width in HTML

Note: Server-side resizing is a good idea but deferred for now.

#### [P2] Upload an image via drag/drop

#### [P2] Upload an image via file picker

### Image editing

- [P1] Resize handles on hover—dragging updates the `width` attribute in markdown source
- [D] Image deletion from page (defer—need to decide if we also delete the file)
- [P2] Drag images to reorder within the page

---

## Architecture decisions

- **REST API:** All editing operations go through API endpoints (`POST /api/save`, `POST /api/upload`). This sets up for future AI integration and multi-user features.
- **Undo/redo:** Use CodeMirror 6's built-in undo. Document-level undo (across saves) deferred.
- **Multi-user:** Defer entirely. Will need more robust data structures (CRDT, OT) for concurrent editing.

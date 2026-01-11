---
title: Glint V3 - Commenting System Design
author: Jarred Barber
date: 2026-01-10
---

Recap:

* V1: Display, browse files
* V2: Editing, images
* V3: Commenting (this doc)

---

## Overview

V3 adds a **Google Docs-style commenting system** to Glint. Users can highlight text and add comments that are visible to all readers/editors. Comments are stored externally (not in the markdown source) to keep markdown files clean for version control.

---

## Design Goals

1. **Clean markdown** — Comments should never pollute the `.md` source file
2. **Portable storage** — Comments stored in simple JSON files alongside content
3. **Git-friendly** — Comment files are human-readable and diffable
4. **Robust anchoring** — Comments should survive minor edits to the source text
5. **Intuitive UX** — Matches user expectations from Google Docs / Word
6. **Testable anchoring** — Anchor resolution should be a pure, unit-testable algorithm

---

## Key Design Decisions

> [!IMPORTANT]
> These decisions were made during architectural review to avoid ambiguity during implementation.

### Anchor Target: Source Markdown (Not Rendered DOM)

Comments anchor to the **raw markdown source**, not the rendered HTML text content. This is critical because:

* KaTeX transforms `$$x^2$$` into complex HTML that doesn't match the source
* Wiki-links `[[Page]]` render as `<a>Page</a>`
* Mermaid diagrams have no meaningful text content

**Resolution flow:**

1. Server loads comments and markdown source
2. Server resolves anchors against source text, returning line numbers
3. Client uses `data-source-line` attributes (already present) to map to DOM elements
4. Client highlights the text within those elements

This leverages existing source line infrastructure from V2.

### Excluded Regions

The following elements are **not selectable** for comments in V3:

* Math blocks (`$`, `$$`, `$$$`)
* Mermaid diagrams
* Code blocks (consider for V4)
* Images (consider for V4)

The client-side selection handler will detect these and prevent comment creation.

### SSE Hot Reload Interaction

When the markdown file changes, SSE triggers a page reload. To prevent data loss:

* **Suppress SSE reload** while a comment input is active (same pattern as section editor)
* Queue pending comment saves before allowing reload
* Show warning if reload is blocked by unsaved comment

---

## Architecture

### Storage Pattern

Following the established pattern for images, comments are stored in auxiliary files:

```
docs/
  my-article.md
  my-article.md.assets/           # existing: images
  my-article.md.comments.json     # new: comments
```

This mirrors the `{article}.assets/` convention for images and keeps related data colocated.

### Comment Data Model

```typescript
interface Comment {
    id: string;                    // nanoid or uuid
    createdAt: string;             // ISO timestamp
    updatedAt: string;             // ISO timestamp
    author?: string;               // Display name (optional, for V3+ multi-user)
    
    // Anchor position (see Anchoring Strategy below)
    anchor: TextAnchor;
    
    // Content
    body: string;                  // Plain text only (no markdown for V3)
    resolved: boolean;             // Whether comment is resolved/closed
    
    // Threading
    parentId?: string;             // For replies (null = top-level comment)
}

interface TextAnchor {
    // Primary: Text-based matching (survives edits)
    text: string;                  // The exact selected text (from source markdown)
    prefix: string;                // ~50 chars before selection in source
    suffix: string;                // ~50 chars after selection in source
    
    // Secondary: Line-based fallback (required for inline precision)
    startLine: number;             // Original source line number
    endLine: number;               // For multi-line selections
    startOffset: number;           // Character offset within startLine (required)
    endOffset: number;             // Character offset within endLine (required)
}

interface CommentsFile {
    version: 1;
    articlePath: string;           // Relative path to the .md file
    comments: Comment[];           // Excludes orphaned (stored separately)
    orphaned?: Comment[];          // Comments that couldn't be anchored
}
```

### Anchoring Strategy

The biggest challenge is **anchoring comments to text** that may change. We use a multi-level approach:

**Level 1: Text + Context Matching (Primary)**

* Store the selected text plus surrounding context (prefix/suffix)
* On render, search for this pattern in the current content
* This is resilient to edits elsewhere in the document

**Level 2: Fuzzy Matching (Fallback)**

* If exact match fails, use fuzzy string matching (Levenshtein distance)
* Accept matches above a similarity threshold (e.g., 80%)
* Flag comments as "low confidence" if match is weak

**Level 3: Line-Based (Last Resort)**

* Fall back to line numbers if text matching fails entirely
* Show warning: "Comment may be misplaced due to edits"

---

## REST API Additions

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/comments/*` | GET | Fetch comments for an article |
| `/api/comments/*` | POST | Create a new comment |
| `/api/comments/*` | PATCH | Update comment (edit, resolve) |
| `/api/comments/*` | DELETE | Delete a comment |

**Request/Response Examples:**

```typescript
// GET /api/comments/docs/my-article
{
    comments: Comment[],
    orphaned: Comment[]  // Comments that couldn't be anchored
}

// POST /api/comments/docs/my-article
{
    anchor: TextAnchor,
    body: string,
    parentId?: string
}
// Returns: { comment: Comment }

// PATCH /api/comments/docs/my-article/{commentId}
{
    body?: string,
    resolved?: boolean
}
// Returns: { comment: Comment }
```

---

## UI Components

### 1. Comment Highlights

Selected text with comments gets a highlight:

```css
.comment-highlight {
    background-color: var(--comment-bg);  /* subtle yellow/orange */
    border-bottom: 2px solid var(--comment-border);
    cursor: pointer;
}

.comment-highlight.orphaned {
    background-color: var(--comment-orphaned-bg);  /* muted/gray */
    border-style: dashed;
}
```

### 2. Comment Sidebar Panel

A collapsible right-side panel showing active comments:

```
┌──────────────────────────────────┐
│ Comments (3)               [Hide] │
├──────────────────────────────────┤
│ ┌──────────────────────────────┐ │
│ │ "interesting approach..."    │ │
│ │ Author · 2h ago              │ │
│ │                              │ │
│ │ This needs clarification     │ │
│ │ about the edge cases.        │ │
│ │                              │ │
│ │ [Reply]  [Resolve]  [Delete] │ │
│ └──────────────────────────────┘ │
│                                  │
│ ┌──────────────────────────────┐ │
│ │ "the formula for..."         │ │
│ │ Author · 1d ago              │ │
│ │                              │ │
│ │ Check the sign convention.   │ │
│ │                              │ │
│ │ ↳ Reply: "Good catch!..."    │ │
│ │                              │ │
│ │ [Reply]  [✓ Resolved]        │ │
│ └──────────────────────────────┘ │
└──────────────────────────────────┘
```

### 3. Comment Creation Flow

1. User selects text with mouse
2. Small tooltip appears: `[ 💬 Add Comment ]`
3. Click opens inline comment input
4. Save/Cancel buttons submit or discard

```
Selected text becomes highlighted...
                                    ┌─────────────────┐
                                    │ Add a comment...│
                                    │                 │
                                    │                 │
                                    │ [Save] [Cancel] │
                                    └─────────────────┘
```

### 4. Comment-to-Text Navigation

* Clicking a comment in the sidebar scrolls to and highlights the anchored text
* Clicking highlighted text in content scrolls to the comment in sidebar

---

## Implementation Structure

### Server-Side (New Files)

```
src/server/
  services/
    comments.ts            # Load/save/resolve comment anchors
    anchor-resolution.ts   # Pure function: TextAnchor → match result
```

### Client-Side (New Files)

```
src/client/
  comments.ts              # Comment UI logic, selection handling
  comments-panel.ts        # Sidebar panel component
```

### Integration Points

1. **renderer.ts** — Add comment panel to page template
2. **layout.css** — Style comment highlights, sidebar panel
3. **router.ts** — Fetch comments on page load/navigation

### Text Selection Handler

```typescript
// Pseudo-code for comment creation trigger
document.addEventListener('mouseup', (e) => {
    const selection = window.getSelection();
    if (selection && selection.toString().trim().length > 0) {
        const range = selection.getRangeAt(0);
        showCommentTooltip(range);
    }
});
```

---

## Rehype Plugin Considerations

Comments are rendered **at page load time**, not during markdown processing. The flow:

1. Server renders markdown → HTML (no comment awareness)
2. Client fetches `/api/comments/*`
3. Client applies highlights to rendered DOM based on anchors
4. This keeps the unified pipeline simple and stateless

**Alternative considered:** A rehype plugin that injects `<mark>` tags. Rejected because:

* Requires re-rendering on comment changes
* Complicates source line mapping
* Comments are inherently client-side state

---

## File Format

`my-article.md.comments.json`:

```json
{
    "version": 1,
    "articlePath": "docs/my-article.md",
    "comments": [
        {
            "id": "abc123",
            "createdAt": "2026-01-10T12:00:00Z",
            "updatedAt": "2026-01-10T12:00:00Z",
            "anchor": {
                "text": "the eigenvalue problem",
                "prefix": "This section discusses ",
                "suffix": " in detail, focusing on",
                "startLine": 45,
                "endLine": 45
            },
            "body": "Should we include a worked example here?",
            "resolved": false,
            "parentId": null
        },
        {
            "id": "def456",
            "createdAt": "2026-01-10T12:30:00Z",
            "updatedAt": "2026-01-10T12:30:00Z",
            "anchor": {
                "text": "the eigenvalue problem",
                "prefix": "This section discusses ",
                "suffix": " in detail, focusing on",
                "startLine": 45,
                "endLine": 45
            },
            "body": "Good idea, added in the previous commit.",
            "resolved": false,
            "parentId": "abc123"
        }
    ]
}
```

---

## Orphaned Comment Handling

When anchor resolution fails entirely:

1. **Detection**: Comment moves to `orphaned` array in JSON file
2. **UI Display**: Shown at top of sidebar with warning icon and dashed border
3. **User Actions**:
   * **Re-anchor**: Select new text and click "Re-attach comment"
   * **Delete**: Remove orphaned comment permanently
4. **Auto-cleanup**: Orphaned comments older than 30 days are deleted on next save

> [!NOTE]
> Resolved comments are kept inline (not archived) for V3. Consider moving to `.comments.resolved.json` in V4 if performance becomes an issue.

---

## Migration & Versioning

* No migration needed for V3 (new feature)
* **Schema versioning strategy**: On load, check `version` field:
  * If missing or < current, run migration function
  * Migrations are applied in sequence (v1→v2→v3)
  * Always write current version on save

---

## Security Considerations

* Comments file path must be validated same as markdown paths
* Sanitize comment body to prevent XSS (or use markdown rendering with safe defaults)
* Rate limiting for comment creation (if/when multi-user is added)

---

## Implementation Phases

### Phase 1: Core Infrastructure

* [ ] Comment file read/write utilities

* [ ] REST API endpoints (CRUD)
* [ ] Basic client-side comment fetching

### Phase 2: Anchoring

* [ ] Text anchor creation from selection

* [ ] Text anchor resolution on page load
* [ ] Fuzzy matching fallback

### Phase 3: UI

* [ ] Comment highlights in content

* [ ] Comment sidebar panel
* [ ] Create/edit/resolve/delete UI

### Phase 4: Polish

* [ ] Threading/replies support

* [ ] Keyboard shortcuts
* [ ] Resolved comment filtering
* [ ] Animation/transitions

---

## Resolved Design Questions

| Question | V3 Decision | Notes |
|----------|-------------|-------|
| Markdown in comments? | **Plain text only** | Reduces XSS surface, simplifies UI |
| Anonymous vs named? | **Anonymous** | V4 adds author field with local storage persistence |
| Real-time sync? | **Refresh on load** | V4 could add SSE for comment updates |
| Comment on images/diagrams? | **Text only** | Math, diagrams, images excluded from selection |
| Anchor target? | **Source markdown** | Uses existing `data-source-line` infrastructure |

---

## Prior Art

* **Google Docs** — Gold standard for inline comments UX
* **Hypothesis** — Web annotation layer, uses robust anchoring
* **Notion** — Comments on blocks (simpler model than text selection)
* **GitHub PR comments** — Line-based anchoring (simpler but less precise)

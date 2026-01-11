---
title: Glint V3 - Embedded Widgets
author: Jarred Barber
date: 2026-01-11
---

# Glint V3 — Embedded Widgets

V3 introduces **embedded widgets**: structured data that lives in markdown source but renders as interactive UI components.

---

## Widget Types

| Widget | Syntax | Renders As |
|--------|--------|------------|
| **Comment** | ` ```comment ` block | Threaded discussion |
| **Task** | `- [<state>] <description> <attrs>` | Checkbox with metadata |

Future candidates: `poll:`, `embed:`, `alert:`, `progress:`

---

## 1. Comments

Threaded discussions embedded in the document.

### Syntax

```markdown
```comment
jarred@2026-01-10:14:30 Should we add an example here?
clanker@2026-01-10:14:45 Good idea, I'll add one.
jarred@2026-01-10:15:00 Thanks!
```

```

### Format

```

<author>@<YYYY-MM-DD>:<HH:MM> <message>

```

Optional first-line flags:
- `#resolved` — Collapsed, shown as complete
- `#important` — Highlighted accent border

### Rendering

**Expanded:**
```

┌────────────────────────────────────────────────────┐
│ 💬 Comment Thread                           [Hide] │
├────────────────────────────────────────────────────┤
│ jarred · Jan 10, 2:30 PM                           │
│   Should we add an example here?                   │
│                                                    │
│   ↳ clanker · Jan 10, 2:45 PM                      │
│       Good idea, I'll add one.                     │
│                                                    │
│ [Reply]  [Resolve]                                 │
└────────────────────────────────────────────────────┘

```

**Resolved:**
```

┌────────────────────────────────────────────────────┐
│ ✓ Resolved: "Should we add an example..." (2)      │
└────────────────────────────────────────────────────┘

```

---

## 2. Tasks

Inline tasks with metadata, rendered as styled checkboxes.

### Syntax

See TASKS_V3.md

Renders as:

```

┌─────────────────────────────────────────┐
│ 🟦 Schedule meeting with Bob            │
│    📅 Feb 4  ·  @jarred                 │
└─────────────────────────────────────────┘

```

### Interactions

- **Click checkbox** → toggles `state=open` ↔ `state=done`
- **Click due date** → opens date picker (updates inline)
- State changes write back to markdown source

---

## Implementation

### Plugin Architecture

```

src/
  remark-glint-widgets.ts      # Main widget parser
  widgets/
    comment.ts                 # Comment block handler
    task.ts                    # Task line handler

```

### Parsing Strategy

**Comments:** Handled as code block with `lang="comment"`.

**Tasks:** Inline text matching regex:

```typescript
const TASK_REGEX = /^task:\s*(.+?)(?:\s+((?:\w+=\S+\s*)+))?$/;
// Groups: [1] description, [2] attributes
```

### AST Output

Both widgets emit custom HAST nodes:

```typescript
// Comment
{
  type: 'element',
  tagName: 'div',
  properties: { className: 'glint-widget glint-comment', dataResolved: 'false' },
  children: [/* rendered thread */]
}

// Task
{
  type: 'element',
  tagName: 'div',
  properties: { 
    className: 'glint-widget glint-task',
    dataState: 'open',
    dataDue: '2026-02-04'
  },
  children: [/* rendered task */]
}
```

---

## Styling

```css
/* Base widget styles */
.glint-widget {
    margin: 0.75rem 0;
    padding: 0.75rem 1rem;
    border-radius: 6px;
    border-left: 3px solid var(--accent);
    background: var(--widget-bg);
}

/* Comments */
.glint-comment { border-left-color: var(--comment-accent); }
.glint-comment[data-resolved="true"] { 
    opacity: 0.6; 
    border-left-color: var(--success); 
}

/* Tasks */
.glint-task { border-left-color: var(--task-accent); }
.glint-task[data-state="done"] { 
    opacity: 0.6;
    text-decoration: line-through;
}
.glint-task[data-state="blocked"] { border-left-color: var(--warning); }
.glint-task[data-overdue="true"] { border-left-color: var(--error); }
```

---

## Client Interactions

All widget updates write back to the markdown source using the existing `/api/save` endpoint.

### Comment Actions

| Action | Effect |
|--------|--------|
| Reply | Appends `\nauthor@timestamp message` to block |
| Resolve | Prepends `#resolved\n` to block |

### Task Actions

| Action | Effect |
|--------|--------|
| Toggle done | Changes `state=open` ↔ `state=done` |
| Set due date | Updates/adds `due=YYYY-MM-DD` |
| Clear due | Removes `due=...` attribute |

---

## Configuration

In `glint.json`:

```json
{
    "widgets": {
        "defaultAuthor": "jarred",
        "taskDueDateFormat": "relative"  // "relative" | "absolute"
    }
}
```

---

## Future Widgets

| Widget | Syntax | Description |
|--------|--------|-------------|
| `poll:` | `poll: Question? opt1 / opt2 / opt3` | Inline poll |
| `embed:` | `embed: https://...` | Rich embed (oembed) |
| `progress:` | `progress: 3/10 label="Chapter review"` | Progress bar |
| `alert:` | `alert: Warning message type=warning` | Styled callout |

---

## Open Questions

1. **Author default** — Use `glint.json` config or prompt on first comment?

- Prompt on first comment for now

1. **Task queries** — Future: aggregated task list view across all files?

- Maybe but we'll deal with that later

1. **Sync** — Should task state changes trigger SSE to other viewers?

- Not for now. Still assuming a single-user system design.

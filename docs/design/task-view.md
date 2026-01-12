# Task View Design

## Goal

Create an aggregated view that displays all tasks across all markdown files in the content directory. Users can view, filter, and interact with tasks from a single page.

## URL/Route

`/tasks` - Dedicated route for the task view.

## Features

### Task Aggregation

- Scan all `.md` files in content directory
- Extract task items ( `- [state] description` )
- Track source file + line number for each task

### Filtering & Display

- **State filter**: Show open/in-progress/waiting/blocked (hide done/cancelled by default)
- **Completion hiding**: Tasks marked `done` or `cancelled` for > N days (config default: 7) are hidden
- **Grouping**: Group by source file OR due date
- **Sorting**: By due date, then priority

### Caching Strategy

To avoid scanning the entire folder on every request:

1. **File Cache**: Store extracted tasks per-file, keyed by `(path, mtime)`
2. **On Startup**: Full scan, populate cache
3. **On File Change**: Invalidate/update only the changed file
4. **Background Refresh**: SSE triggers refresh when files change

### Interactions

- **Click task checkbox**: Toggle state via API (`/api/task/toggle`)
- **Click task text**: Navigate to source file, scroll to line
- **Real-time updates**: SSE pushes task changes to connected clients

## Architecture

### New Files

| File | Purpose |
|------|---------|
| `src/tasks/scanner.ts` | Scan files, extract tasks, manage cache |
| `src/tasks/types.ts` | Task interface with source metadata |
| `src/server/routes/tasks.ts` | `/tasks` route + `/api/tasks` API |
| `src/client/task-view.ts` | Client-side filtering/interaction |
| `assets/task-view.css` | Dedicated styles |

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/tasks` | GET | Render task view page |
| `/api/tasks` | GET | JSON list of all tasks |
| `/api/task/toggle` | POST | Toggle task state in source file |

## Open Questions for User

1. **Plugin system?** Should tasks become a first-class "plugin"? (Deferred - add later if needed)
2. **Shareable?** Should `/tasks` respect auth/sharing? (Yes, same as normal pages)
3. **Group by file or date?** (Default: by file, with option to toggle)

## Implementation Order

1. Task Scanner + Cache
2. API Route `/api/tasks`
3. Page Route `/tasks`
4. Client interactivity
5. State toggle API

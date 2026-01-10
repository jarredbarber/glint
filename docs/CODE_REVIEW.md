# Code Review (Phases 1-4)

## Summary

The implementation is functional and meets the requirements for a single-user Markdown server. However, `src/server.ts` has grown significantly and handles too many responsibilities (Server, API, Rendering, File System). There are also some potential bugs regarding file updates and data safety.

## 1. `src/server.ts`

### 🚩 Critical Issues

- **Static File Tree**: The `fileTree` is built once at startup (line 498) and never updated. Adding new files or folders will not be reflected in the sidebar until the server is restarted.
  - **Fix**: Move `buildFileTree` call into the request handler or re-build it when the watcher detects file changes.

### ⚠️ Refactoring Opportunities

- **Monolothic File**: `server.ts` contains raw HTML string templates (`renderHead`, `renderSidebar`, etc.), API route handlers, and file system logic.
  - **Recommendation**: Extract all `render*` functions into a dedicated `src/renderer.ts`.
- **Duplicated Path Resolution**: The logic to resolve a URL path to a file system path and handle `.md` extensions exists in `resolveSafePath` (lines 259-298) but is reimplemented/tweaked in the main catch-all route (lines 500-542).
  - **Recommendation**: Unify this into a robust `resolveContentPath` utility in a separate module.
- **Hardcoded Paths**: `assetsDir` calculation assumes a specific `dist/` vs `src/` layout.
- **Fragile Hot Reload Logic**: The client-side reload suppression (lines 153-157) involves injecting sensitive logic via string templates.

## 2. `src/client/editor-integration.ts`

### ⚠️ Data Safety

- **Race Condition**: The editor works by fetching the full file, splicing in the new section, and saving the full file. If two tabs are open, or if a background process modifies the file (e.g. sync), the last save will overwrite external changes.
  - **Mitigation**: Implement the optimistic locking (`hash` check) mentioned in the spec (Phase 1).

### ⚡ Performance

- **Over-fetching**: The editor fetches the *entire* source file (`/api/source/:path`) every time an edit icon is clicked. For large documents, this creates unnecessary network and memory load.
  - **Optimization**: Cache the source or fetch only the necessary byte range (requires server support).

## 3. `src/remark-glint-math.ts` & `src/rehype-source-lines.ts`

### Good Practices

- **Robust Mapping**: The new `LineMapping` implementation correctly handles the line count discrepancies introduced by LaTeX expansion, ensuring accurate `data-source-line` attributes.

## 4. `src/client/router.ts`

### ⚠️ Potential Issues

- **Event Listeners**: The router attaches a global `click` listener. Ensure this doesn't conflict with the `upload.ts` or `editor-integration.ts` listeners. (Current inspection shows they are properly isolated).

## Recommendations

1. **Refactor Server**: split `server.ts` into `server.ts` (Fastify setup), `api.ts` (Routes), and `renderer.ts` (HTML generation).
2. **Fix Sidebar**: Ensure `fileTree` is dynamic.
3. **Unify Path Logic**: Create a canonical `fs-utils.ts` for safe path resolution.
4. **Optimistic Locking**: Enforce the `hash` check on `/api/save` to prevent accidental overwrites.

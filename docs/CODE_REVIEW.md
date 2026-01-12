# Glint Code Review

> Comprehensive code review of the Glint codebase.
> Last reviewed: 2026-01-11

---

## Summary

The codebase is generally well-structured and functional, but there are opportunities for cleanup, bug fixes, and improvements. Key areas of concern include dead code, duplicate functionality, and a very large client file that should be refactored.

---

## Critical Issues

### 1. Duplicate Math Rendering Setup

**Files:** `server.ts`

The pipeline imports and configures **both** the standard `remark-math` + `rehype-katex` libraries AND a custom `rehype-glint-katex` plugin (which is not used).

```typescript
// Line 8 - remark-math imported
import remarkMath from 'remark-math';
// Line 20 - rehype-katex imported
import rehypeKatex from 'rehype-katex';
// ... but rehypeGlintKatex exists in src/rehype-glint-katex.ts and is NOT used
```

**Impact:** The custom `rehype-glint-katex.ts` is dead code. Either:

- Remove `rehype-glint-katex.ts` entirely (since `rehype-katex` is working)
- Or replace `rehype-katex` with the custom plugin if custom behavior is needed

**Recommendation:** Delete `src/rehype-glint-katex.ts` since the standard library is being used.

---

### 2. Unused Remark/Rehype Plugins

**Files:** `src/rehype-math-enumerate.ts`, `src/remark-slash-checkbox.ts`

These files exist but are not used in the pipeline:

| File | Purpose | Status |
|------|---------|--------|
| `rehype-math-enumerate.ts` | Equation numbering | **Unused** |
| `remark-slash-checkbox.ts` | Custom checkbox notation | **Unused** |

**Recommendation:** Either integrate these into the pipeline or delete them.

---

## Code Quality Issues

### 3. `editor-integration.ts` is Too Large (1198 lines)

**File:** `src/client/editor-integration.ts`

This monolithic file handles too many responsibilities:

- Clipboard image detection
- Edit icon injection
- Preamble/section/code block editing
- Task state management  
- Comment interactions (reply, resolve, delete)
- Keyboard shortcuts
- Line tracker UI

**Recommendation:** Split into focused modules:

```
src/client/
├── edit-icons.ts         # Icon injection logic
├── section-editor.ts     # openInlineEditor, openCodeBlockEditor
├── task-interactions.ts  # Task state toggling
├── comment-actions.ts    # Reply, resolve, delete
├── keyboard-shortcuts.ts # Shortcut handlers
└── line-tracker.ts       # Hover line guide UI
```

---

### 4. Config Loaded Multiple Times

**Files:** `server.ts`, `src/server/routes/api.ts`

Config is loaded separately in both files without shared state:

```typescript
// server.ts
let config = await loadConfig(contentDir);

// api.ts  
let config = await loadConfig(contentDir);  // Separate instance!
```

**Impact:** Theme changes via API update `api.ts`'s config but NOT `server.ts`'s config until file watcher triggers. This is inconsistent but mostly benign.

**Recommendation:** Pass config reference from `createServer` to `setupAPIRoutes` instead of loading twice.

---

### 5. Inconsistent Error Handling Pattern

**Files:** `server.ts`, `src/server/routes/api.ts`

Error messages use raw string matching which is fragile:

```typescript
if (err.message === 'FORBIDDEN') return reply.code(403)...
if (err.message === 'NOT_FOUND') return reply.code(404)...
```

**Recommendation:** Create typed error classes:

```typescript
class ForbiddenError extends Error { code = 403; }
class NotFoundError extends Error { code = 404; }
```

---

## Missing Features / Incomplete Implementations

### 6. No Search Functionality

There is no full-text search across markdown files. This would be valuable for larger documentation sites.

---

### 7. No Mobile/Responsive Sidebar

The sidebar has no mobile collapse behavior. On narrow screens it likely overlaps or is unusable.

---

### 8. Wiki Links Don't Verify Targets

**File:** `src/remark-wiki-link-glint.ts`

Wiki links like `[[Page Name]]` are converted to URLs but there's no validation that the target page exists:

```typescript
const url = encodeURI(target);  // Line 41 - No existence check
```

**Enhancement:** Could add a broken-link indicator or warning during render.

---

### 9. No Export/Print Styling

There's no print stylesheet for generating PDFs from rendered pages.

---

## Refactoring Opportunities

### 10. Extract Mermaid Initialization

**File:** `src/renderer.ts`

Mermaid setup is inline in `renderScripts()`:

```typescript
mermaid.initialize({
    startOnLoad: true,
    theme: 'dark',
    themeVariables: {
        fontFamily: '"Inter", sans-serif',
        primaryColor: '#a7c080',
        // ...hardcoded colors
    }
});
```

**Issue:** These colors are hardcoded to Everforest theme, won't update with theme changes.

**Recommendation:** Either use CSS variables or dynamically configure based on current theme.

---

### 11. Widget Handler Boilerplate

**Files:** `src/widgets/task.ts`, `src/widgets/comment.ts`

Both widgets build HTML manually with string concatenation. The task widget has particularly complex nested MDAST manipulation.

**Recommendation:** Consider a template helper or JSX-like syntax for cleaner widget HTML generation.

---

### 12. Scroll Preservation Logic Duplicated

**Files:** `src/client/upload.ts`, `src/client/editor-integration.ts`

The pattern `saveScrollPosition() → suppressSSEReload() → window.location.reload()` appears in multiple places.

**Recommendation:** Extract to a shared helper function in `scroll-utils.ts`:

```typescript
export function saveAndReload() {
    saveScrollPosition();
    suppressSSEReload();
    window.location.reload();
}
```

---

## Minor Issues

### 13. Unused Type Import

**File:** `src/widgets/comment.ts`

```typescript
import { visit } from 'unist-util-visit';  // Imported but only used for VisitorResult type
```

The `visit` function is imported but never called—only the types are used.

---

### 14. Inconsistent CONTINUE Constants

**File:** `src/widgets/comment.ts`

```typescript
const CONTINUE = undefined; // Line 13 - manually defined
```

But `src/widgets/task.ts` uses:

```typescript
import { CONTINUE } from 'unist-util-visit';  // Proper import
```

**Recommendation:** Use the official import consistently.

---

### 15. Default Theme Mismatch

**Files:** `src/config.ts`, `src/renderer.ts`

```typescript
// config.ts line 18
theme: 'nord',  // DEFAULTS

// renderer.ts line 32
currentTheme: string = 'everforest-dark'  // Different default!
```

---

### 16. IDE Hint: Unused Variable

**File:** `src/markdown.ts`

```typescript
const [, leadingSpace, mathContent] = displayMathMatch;  // leadingSpace captured but used
```

Variable `leadingSpace` is used (line 38), but this pattern could be clearer.

---

## Security Considerations

### 17. Directory Traversal Protection Exists ✓

`src/utils/fs-utils.ts` correctly checks path containment:

```typescript
if (!safePath.startsWith(contentDir)) {
    throw new Error('FORBIDDEN');
}
```

This is good. No immediate security issues found.

---

### 18. Content Sanitization

HTML from markdown is rendered with `allowDangerousHtml: true`. This is intentional for features like raw HTML in markdown, but worth noting.

---

## Architecture Observations

### Good Patterns

- **LRU caching** for rendered HTML with mtime invalidation
- **SSE hot-reload** with editing suppression
- **Optimistic locking** with hash verification on saves
- **Modular plugin pipeline** using unified ecosystem
- **Clean widget handler interface** for extensibility

### Areas for Improvement

- Large client bundle size (5 separate bundle files)
- No code-splitting or lazy loading
- No TypeScript strict mode enabled
- Missing unit/integration tests

---

## Recommended Priorities

| Priority | Issue | Effort |
|----------|-------|--------|
| 🔴 High | Delete unused `rehype-glint-katex.ts` | Low |
| 🔴 High | Delete unused `rehype-math-enumerate.ts` | Low |
| 🟡 Medium | Split `editor-integration.ts` into modules | Medium |
| 🟡 Medium | Share config between server and API routes | Low |
| 🟢 Low | Create typed error classes | Low |
| 🟢 Low | Fix theme-aware mermaid colors | Low |
| 🟢 Low | Add print stylesheet | Medium |
| 🔵 Future | Add full-text search | High |
| 🔵 Future | Mobile sidebar collapse | Medium |

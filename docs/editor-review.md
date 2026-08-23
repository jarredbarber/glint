# Editor & Line-Mapping Design Review

*For issue #8. Written 2026-08-23. Files: `editor-integration.ts`, `editor-shortcuts.ts`, `editor-sessions.ts`, `rehype-source-lines.ts`, `rehype-glint-sections.ts`, `assets/layout.css`.*

## The core problem

The "which line do I act on?" signal is derived from **transient mouse-hover coordinates**, stored in `.line-tracker-hint`'s `dataset.line` by a `mousemove` handler. Both shortcuts (`e` edit, `c` comment) read only that. Everything that "sometimes doesn't open / opens on the wrong line" traces back to this one design choice: intent is inferred from where the mouse last happened to be, not from a stable cursor.

## Findings, ranked by impact

### 1. The scroll listener is attached to the wrong element (confirmed bug)

`editor-integration.ts:163` attaches the tracker's `scroll` handler to `.content-wrapper`. But `.content-wrapper` never scrolls — `assets/layout.css:663` gives **`.content`** `overflow-y: auto`; `.content-wrapper` is a static inner box (`max-width:800px; margin:auto`). So the handler **never fires.**

**Effect:** after any wheel/keyboard/trackpad scroll (mouse stationary), `dataset.line` still holds the pre-scroll line — now scrolled off-screen. Press `e` → editor opens on that stale, off-screen line. This is the "opens on wrong line" report.

*(Even if it fired, it re-runs `updateTracker(lastX, lastY, …)` with the last mouse coords — `elementFromPoint` at a fixed screen point after content moved = a different element. Scroll-tracking via saved mouse coords is wrong in principle.)*

**Fix:** don't track lines by mouse at all for the keyboard path. Compute the current section from the viewport on demand (see §5).

### 2. Fresh page / mouse-never-moved → silent no-op

`dataset.line` is only ever set inside `mousemove`. On a freshly loaded page, or after `mouseleave` (which doesn't clear it but a prior `updateTracker` with no `focusedSection` deletes it), pressing `e`/`c` hits `if (!hint) return` / `if (!lineStr) return` and **does nothing, with no feedback.** This is the "sometimes doesn't open" report. Keyboard-only users can never edit.

### 3. Every failure path is silent

`editCurrentSection`, `insertCommentBlock`'s trigger, and the tracker all `return` quietly on a missing line. From the user's seat, a dead keypress is indistinguishable from a bug. Minimum viable fix: flash the hint or a one-line toast ("hover or scroll to a section first") so the tool feels deterministic.

### 4. Section boundaries are computed three different ways

- `editCurrentSection` (`editor-shortcuts.ts`): scans `.content-wrapper` headings for nearest preceding.
- `openInlineEditor` (`editor-sessions.ts:150`): re-derives the end by scanning **`document.querySelectorAll('h1..h6')`** — global, *not* scoped to `.content-wrapper` (inconsistent with the fix that landed for §caller; any heading in page chrome skews the index).
- The tracker's `nextLine`: `nextElementSibling` DOM walk.
- `upload.ts`: a fourth next-line scan.

Four algorithms that can disagree. They already do, because of §5.

### 5. The `<section>` wrapper exists but the editor ignores it

`rehype-glint-sections.ts` already wraps content into `<section class="glint-section" data-section-line=N>` with correct heading hierarchy — the exact "what belongs to this section" structure the editor keeps re-deriving by hand. But:
- The heading-sibling walks (`nextElementSibling`) now operate on elements nested **inside** `<section>`, so "next section" logic that assumed flat siblings is subtly wrong across section boundaries.
- The editor never uses `data-section-line` or the section subtree to decide what to hide/extract.

### 6. `EDITOR_LINE_BUFFER = 5` is a band-aid over imprecise mapping

`editor-sessions.ts:139` grabs ±5 lines around the computed section because the boundaries aren't trusted. The editor then shows slop from adjacent sections, and save relies on `activeEditor.currentStartLine/currentEndLine` + a splice `deleteCount` to put it back. If `data-source-line` is off by a little, the buffer hides the symptom but the save splice can clobber neighboring lines. A correct boundary makes the buffer unnecessary.

### 7. `data-source-line` has gaps

`rehype-source-lines.ts` only tags `BLOCK_TAGS` that still carry `node.position.start`. Elements produced by `rehype-raw` re-parsing widget HTML, and math/mermaid output, can lose position → no attribute. Hover over such an element resolves via `closest('[data-source-line]')` to some ancestor, possibly far off. Another wrong-line vector, and it's data-dependent (explains "flaky").

## Recommended redesign (minimal, uses what already exists)

**Make the `<section>` the edit unit and resolve the current section from the viewport, not the mouse.**

1. **One resolver.** Add `getCurrentSection(): HTMLElement | null` = the first `.glint-section` (or `[data-source-line]` for preamble) whose `getBoundingClientRect().bottom > headerOffset`, i.e. the top-most section intersecting the viewport. Prefer an `IntersectionObserver` on `.content .glint-section` that keeps a `currentSection` variable; fall back to a rect scan. No mouse dependency → fixes §1, §2 for the keyboard path.

2. **`e` edits that section's subtree directly.** start = `section.dataset.sectionLine`; end = next sibling `.glint-section`'s line (walking up for the enclosing level), else EOF. hidden = the section's own children with `[data-source-line]`. This deletes the ±5 buffer (§6), the global heading scan (§4/§5), and the splice guesswork — the DOM already says exactly which lines and elements the section owns.

3. **Keep mouse hover as a *refinement only*.** When the mouse is over a section, prefer it; otherwise use the viewport resolver. The badge still follows the mouse; the *action target* falls back to viewport so keypresses always do something.

4. **Fail loud.** If no section resolves (empty doc), flash a toast. Never a silent `return`.

5. **Consolidate.** `getSectionRange(section)` used by edit, comment-insert, and upload. Delete the three duplicate scans. Scope everything to `.content-wrapper`; drop `document.querySelectorAll('h1..h6')`.

6. **Close the map gaps (separate, smaller).** In `rehype-source-lines`, when a block element lacks a position, inherit the nearest positioned ancestor/preceding sibling's line so every block resolves to *something* sensible. Lower priority once §2 makes the section (not the element) the unit.

## Effort

- §1 + §2 + §4 fold into the resolver rewrite: **~half a day**, ~80 lines net, mostly deletion. Highest ROI — kills the two headline bugs.
- §5/§6 (section-as-unit + drop buffer): **~1 day**, touches `openInlineEditor` save math; needs a test on the splice.
- §7 (map gaps): **~2h**, independent.

## Leave-behind test

The splice/boundary logic (§6) is the money path — one test: given a fixture markdown, assert `getSectionRange` for a mid-doc heading returns `[headingLine, nextHeadingLine)` and that hide-set == section subtree. That's the smallest thing that fails if boundary logic breaks.

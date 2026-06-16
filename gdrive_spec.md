# Drive Markdown — Chrome Extension Spec

A Chrome Extension that adds a first-class Markdown experience to Google Drive: rendered preview, inline editing, and native Drive comments. Completely serverless — the bundle is the app, OAuth runs through `chrome.identity`, all API calls go directly to Google.

---

## What It Does

When the user opens a `.md` file in Google Drive, the extension replaces Drive's default preview with:

- **Rendered markdown** — headers, code blocks with syntax highlighting, math (KaTeX), tables, task lists
- **Inline editor** — CodeMirror 6 in a resizable right-hand column; preview stays visible alongside it
- **Drive Comments** — comment cards in a gutter between the preview and editor, aligned vertically to their quoted text

No server. No redirect URL. Nothing to deploy.

---

## UI

### Layout

The extension injects a full-screen panel that replaces Drive's preview UI when a `.md` file is open at `/file/d/{id}/view`. The rendered preview is always visible. Comments live in a fixed-width gutter to the right of the preview, vertically aligned to their quoted text. The editor opens as a further right-hand column.

**Preview + comment gutter (default):**

```
┌──────────────────────────────────────────────────────────────────┐
│  📄 filename.md                              [✎ Edit] [✕ Close]  │
├────────────────────────────────────────┬─────────────────────────┤
│                                        │                         │
│  [rendered markdown]                   │  ┌─────────────────┐   │
│                                        │  │ 💬 Alice        │   │
│  paragraph that was commented on...    │◀─│ "quoted text"   │   │
│                                        │  │ Jun 16  [Reply] │   │
│                                        │  └─────────────────┘   │
│                                        │                         │
│  another paragraph further down...     │◀─┌─────────────────┐   │
│                                        │  │ 💬 Bob · Jun 16 │   │
│                                        │  │ "other passage" │   │
│                                        │  └─────────────────┘   │
│                                        │                         │
├────────────────────────────────────────┴─────────────────────────┤
│  [+ Add a comment...]                                            │
└──────────────────────────────────────────────────────────────────┘
```

**With editor open (three columns):**

```
┌──────────────────────────────────────────────────────────────────┐
│  📄 filename.md                    ● [Save] [✎ Edit] [✕ Close]  │
├──────────────────────┬─────────────────────┬───┬─────────────────┤
│                      │                     │   │                 │
│  [rendered markdown] │  ┌───────────────┐  │ ⋮ │  [CodeMirror]  │
│                      │  │ 💬 Alice      │  │   │                │
│  commented para...   │◀─│ "quoted text" │  │   │                │
│                      │  │ [Reply]  [✓]  │  │   │                │
│                      │  └───────────────┘  │   │                │
│                      │                     │   │                │
├──────────────────────┴─────────────────────┴───┴─────────────────┤
│  [+ Add a comment...]                                            │
└──────────────────────────────────────────────────────────────────┘
```

The comment gutter is fixed at 220px. The `⋮` drag handle sits between the gutter and editor — drag left to expand the editor, drag right to narrow it. The split position is persisted in `chrome.storage.sync`. Clicking **✎ Edit** again closes the editor column.

**Drag handle implementation** (`DragHandle.tsx`): on `pointerdown`, capture the pointer (`el.setPointerCapture(e.pointerId)`) and record the starting X position and current `editorWidth.value`. On `pointermove`, compute the delta from the start X and subtract it from the starting width (dragging left = positive delta = wider editor). Clamp to `[200, window.innerWidth - 440]`. Update `editorWidth.value` and the panel's `--editor-width` CSS custom property. On `pointerup`, persist `editorWidth.value` to `chrome.storage.sync`. Use pointer events rather than mouse events so drag continues if the cursor leaves the handle briefly.

### CSS layout

The panel uses CSS Grid with four named rows and four named columns:

```css
.panel {
  display: grid;
  grid-template-rows: 48px 1fr auto;          /* toolbar | content | comment-bar (3 rows) */
  grid-template-columns: 1fr 220px 4px 0px;   /* preview | gutter | handle | editor (0 when closed) */
  height: 100vh;
  position: fixed;
  inset: 0;
  z-index: 2147483647;
}

/* Editor open: last column expands to saved split width */
.panel.editor-open {
  grid-template-columns: 1fr 220px 4px var(--editor-width, 400px);
}

.toolbar    { grid-column: 1 / -1; grid-row: 1; }
.preview    { grid-column: 1;      grid-row: 2; overflow-y: auto; }
.gutter     { grid-column: 2;      grid-row: 2; position: relative; overflow: visible; }
.drag-handle{ grid-column: 3;      grid-row: 2; cursor: col-resize; }
.editor-col { grid-column: 4;      grid-row: 2; overflow: hidden; }
.comment-bar{ grid-column: 1 / -1; grid-row: 3; }
```

`--editor-width` is a CSS custom property set inline on `.panel` from the persisted split position. The drag handle updates it on `mousemove`.

### Comment positioning

Comment cards are absolutely positioned within the gutter (which has `position: relative; overflow: visible`). After the preview renders, each card's `top` is set by finding the quoted text in the preview DOM:

```typescript
function positionComments(comments: Comment[], previewEl: HTMLElement, gutterEl: HTMLElement) {
  const previewTop = previewEl.getBoundingClientRect().top;
  let minTop = 0; // tracks the bottom of the last placed card to resolve overlaps

  for (const comment of sortedBySourcePosition(comments, previewEl)) {
    const card = gutterEl.querySelector<HTMLElement>(`[data-comment-id="${comment.id}"]`);
    if (!card) continue;
    const anchor = findQuotedTextElement(previewEl, comment.quotedFileContent?.value);
    const naturalTop = anchor
      ? anchor.getBoundingClientRect().top - previewTop + previewEl.scrollTop
      : null;
    const top = naturalTop !== null ? Math.max(naturalTop, minTop) : minTop;
    card.style.top = `${top}px`;
    minTop = top + card.offsetHeight + 8; // 8px gap between cards
  }
}

function findQuotedTextElement(root: HTMLElement, text: string | undefined): Element | null {
  if (!text) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    if (walker.currentNode.textContent?.includes(text)) {
      return walker.currentNode.parentElement;
    }
  }
  return null;
}

// Sort comments by the vertical position of their anchor in the current render,
// falling back to createdTime for comments whose text is no longer found.
function sortedBySourcePosition(comments: Comment[], previewEl: HTMLElement): Comment[] {
  return [...comments].sort((a, b) => {
    const aEl = findQuotedTextElement(previewEl, a.quotedFileContent?.value);
    const bEl = findQuotedTextElement(previewEl, b.quotedFileContent?.value);
    const aTop = aEl ? aEl.getBoundingClientRect().top : Infinity;
    const bTop = bEl ? bEl.getBoundingClientRect().top : Infinity;
    return aTop - bTop;
  });
}
```

Re-run positioning after: initial render, window resize, and each save.

**Synchronisation with Preview DOM:** `positionComments` must run after the Preview component has committed its `innerHTML` to the DOM, not just after `renderedHtml` changes. In `Gutter.tsx`, use a `useEffect` that depends on `renderedHtml.value` with a `requestAnimationFrame` to wait for the browser paint cycle:

```typescript
// Gutter.tsx
import { useEffect } from 'preact/hooks';
import { renderedHtml, comments } from './state';

export function Gutter({ previewRef }: { previewRef: RefObject<HTMLDivElement> }) {
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      if (previewRef.current && gutterRef.current) {
        positionComments(comments.value, previewRef.current, gutterRef.current);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [renderedHtml.value, comments.value]);
  // ...
}
```

`Preview.tsx` exposes its container ref as a prop passed down from `Panel.tsx` so `Gutter` can measure it.

### Saving

- **Ctrl+S** or the **Save** button (shown in the toolbar only when the editor is open) writes back to Drive.
- The `●` dot appears in the toolbar when editor content diverges from the fetched version.
- On save, fetch current metadata (`files.get?fields=modifiedTime`) and compare against `modifiedTime.value`. If changed, show a confirm dialog ("File was modified externally. Overwrite?") before proceeding. On confirm, proceed with the PATCH and update `modifiedTime.value` from the response.
- Preview re-renders after a successful save (markdown signal is unchanged — `renderedHtml` recomputes automatically). Drive creates a version history entry automatically.

### Adding a comment

**Shadow DOM and text selection:** `document.getSelection()` does not return selections made inside a shadow root. Use `shadowRoot.getSelection()` instead — this is Chrome-specific but correct for this extension:

```typescript
// Preview.tsx
function getSelectionText(): string {
  // Must use the shadow root's selection, not document.getSelection()
  const sel = (previewRef.current?.getRootNode() as ShadowRoot).getSelection?.();
  return sel?.toString().trim() ?? '';
}
```

Flow: user selects text in the preview → on `mouseup`, call `getSelectionText()`. If non-empty, show a small absolutely-positioned `<button class="quote-btn">💬</button>` near the selection (position it at `sel.getRangeAt(0).getBoundingClientRect()`). On click, store the selected text in a local signal `pendingQuote` and open a draft card in the gutter at the selection's vertical position. On submit, `quotedFileContent.value` is set to the selected text and the card is persisted via the Drive API.

---

## Framework and State

### Framework: Preact + Signals

Use **Preact** (`preact` + `@preact/signals`) for the component tree. esbuild handles JSX via:

```json
// tsconfig.json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "preact"
  }
}
```

Do not use React. Do not use Vue. Do not use vanilla DOM manipulation for component rendering.

### Shared signals

Define these signals in `src/content/state.ts` and import them directly in any component that needs them. Do not prop-drill these values.

```typescript
import { signal, computed } from '@preact/signals';

export const fileId      = signal<string | null>(null);
export const fileName    = signal<string>('');
export const markdown    = signal<string>('');           // source content
export const modifiedTime= signal<string>('');           // last known Drive modifiedTime
export const editorOpen  = signal<boolean>(false);
export const editorWidth = signal<number>(400);          // px, persisted to chrome.storage.sync
export const unsaved     = signal<boolean>(false);
export const comments    = signal<Comment[]>([]);
export const error       = signal<string | null>(null);  // null = no error

// Derived — renderMarkdown is synchronous (marked default config, no async plugins)
export const renderedHtml = computed(() => renderMarkdown(markdown.value));
```

### Component data flow

```
index.ts
  └── mount(fileId) → sets fileId signal, triggers data load
        ├── driveApi.getFile()  → sets markdown, fileName, modifiedTime signals
        └── driveApi.listComments() → sets comments signal

Panel (reads: fileName, editorOpen, unsaved, error)
  ├── Toolbar (reads: fileName, editorOpen, unsaved — buttons write editorOpen, calls save())
  ├── Preview (reads: renderedHtml — on text select, writes pendingQuote local state)
  ├── Gutter  (reads: comments, renderedHtml — positions cards after renderedHtml changes)
  │     └── CommentCard[] (reads: comment — writes comments signal on reply/resolve)
  ├── DragHandle (reads: editorWidth — writes editorWidth, persists to chrome.storage.sync)
  ├── Editor (reads: markdown — writes markdown + unsaved signals on change)
  └── CommentBar (writes: comments signal on submit)
```

### mount / unmount

```typescript
// content/index.ts
import { render } from 'preact';
import { Panel } from './Panel';
import { fileId, markdown, comments, error } from './state';

let container: HTMLDivElement | null = null;
let shadowRoot: ShadowRoot | null = null;

export function mount(id: string) {
  unmount();
  container = document.createElement('div');
  document.body.appendChild(container);
  shadowRoot = container.attachShadow({ mode: 'open' });
  injectStyles(shadowRoot); // KaTeX + hljs CSS — see "CSS in the Shadow DOM" section
  render(<Panel />, shadowRoot);
  fileId.value = id;
  loadFile(id);
}

export function unmount() {
  if (shadowRoot) {
    // Unmount Preact before removing the DOM node — Preact still holds
    // references into the shadow root and errors if the node is gone first.
    render(null, shadowRoot);
    shadowRoot = null;
  }
  if (container) {
    container.remove();
    container = null;
  }
  // Reset signals
  fileId.value = null;
  markdown.value = '';
  comments.value = [];
  error.value = null;
  unsaved.value = false;
}

async function loadFile(id: string) {
  try {
    const [meta, content, commentList] = await Promise.all([
      driveApi.getMetadata(id),
      driveApi.getContent(id),
      driveApi.listComments(id),
    ]);
    if (!meta.name.endsWith('.md')) { unmount(); return; }
    fileName.value = meta.name;
    modifiedTime.value = meta.modifiedTime;
    markdown.value = content;
    comments.value = commentList;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
```

### Error display

When `error.value` is non-null, `Panel` renders an error banner across the top of the content area in place of the preview:

```tsx
// Panel.tsx
{error.value && (
  <div class="error-banner">
    ⚠ {error.value} <button onClick={() => error.value = null}>Dismiss</button>
  </div>
)}
```

All `driveApi` calls that fail should set `error.value` to a human-readable message and resolve without throwing, so callers don't need try/catch individually.

---

## File Detection

Google Drive is a SPA. Two URL patterns trigger the extension:

1. **Direct open** — `https://drive.google.com/file/d/{fileId}/view`. File ID is in the URL.
2. **In-browser navigation** — Drive updates the URL client-side. Use `chrome.webNavigation.onHistoryStateUpdated` filtered to `drive.google.com`.

```typescript
// content/index.ts
function extractFileId(url: string): string | null {
  const m = url.match(/\/file\/d\/([^/?#]+)/);
  return m ? m[1] : null;
}

let currentFileId: string | null = null;

function tryMount(url: string) {
  const id = extractFileId(url);
  if (id && id !== currentFileId) {
    currentFileId = id;
    mount(id);
  } else if (!id && currentFileId) {
    currentFileId = null;
    unmount();
  }
}

tryMount(window.location.href);

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'URL_CHANGED') tryMount(msg.url);
});
```

```typescript
// background/service-worker.ts
chrome.webNavigation.onHistoryStateUpdated.addListener(
  ({ tabId, url }) => chrome.tabs.sendMessage(tabId, { type: 'URL_CHANGED', url }),
  { url: [{ hostContains: 'drive.google.com' }] }
);
```

---

## Architecture

```
src/
├── manifest.json
├── content/
│   ├── index.ts           — entry point: file detection, mount/unmount, loadFile
│   ├── state.ts           — all shared signals (fileId, markdown, comments, etc.)
│   ├── Panel.tsx          — root component: grid layout, error banner
│   ├── Toolbar.tsx        — filename, edit toggle, save button, unsaved dot
│   ├── Preview.tsx        — renders renderedHtml signal into a div; exposes ref for positioning
│   ├── Gutter.tsx         — absolutely-positioned comment cards; runs positionComments after render
│   ├── CommentCard.tsx    — single comment thread: quote, replies, reply input, resolve button
│   ├── DragHandle.tsx     — mousemove resize logic, updates editorWidth signal
│   ├── Editor.tsx         — CodeMirror 6 wrapper; reads markdown signal, writes on change
│   ├── CommentBar.tsx     — "Add a comment" input at the bottom
│   ├── render.ts          — renderMarkdown(src): string using marked + KaTeX + hljs
│   └── driveApi.ts        — typed Drive REST wrappers; sets error.value on failure
├── background/
│   └── service-worker.ts  — token management, webNavigation relay
└── styles/
    └── panel.css          — base styles (inlined into shadow root at build time)
```

---

## Drive API

### Startup sequence

`loadFile` fires three requests in parallel (see mount/unmount section above). If metadata shows the file is not `.md`, call `unmount()` immediately.

### Read file content

```
GET https://www.googleapis.com/drive/v3/files/{fileId}?alt=media
Authorization: Bearer {token}
```

Response is raw text — call `.text()` on the response, not `.json()`.

### Get file metadata

```
GET https://www.googleapis.com/drive/v3/files/{fileId}?fields=id,name,mimeType,modifiedTime
Authorization: Bearer {token}
```

### Save file content

```
PATCH https://www.googleapis.com/upload/drive/v3/files/{fileId}?uploadType=media
Content-Type: text/plain; charset=UTF-8
Authorization: Bearer {token}

[raw file content]
```

Returns updated metadata including a new `modifiedTime`. Store it in the `modifiedTime` signal.

### List comments

```
GET https://www.googleapis.com/drive/v3/files/{fileId}/comments
  ?fields=comments(id,content,createdTime,author,resolved,quotedFileContent,replies(id,content,author,createdTime,action))
  &includeDeleted=false
  &pageSize=100
```

Follow `nextPageToken` in a loop until absent to retrieve all comments.

### Create comment

```
POST https://www.googleapis.com/drive/v3/files/{fileId}/comments
  ?fields=id,content,createdTime,author
Content-Type: application/json

{
  "content": "comment text",
  "quotedFileContent": {
    "mimeType": "text/plain",
    "value": "the selected passage"
  }
}
```

Omit `quotedFileContent` when there is no associated selection.

### Reply to a comment

```
POST https://www.googleapis.com/drive/v3/files/{fileId}/comments/{commentId}/replies
  ?fields=id,content,createdTime,author
Content-Type: application/json

{ "content": "reply text" }
```

### Resolve / reopen

```
POST https://www.googleapis.com/drive/v3/files/{fileId}/comments/{commentId}/replies
Content-Type: application/json

{ "content": "", "action": "resolve" }
```

`content` is required even with `action` — pass an empty string. Use `"action": "reopen"` to reopen.

---

## OAuth

### Scope

```json
"oauth2": {
  "client_id": "<client-id>.apps.googleusercontent.com",
  "scopes": ["https://www.googleapis.com/auth/drive"]
}
```

`drive.file` only covers files the app created or that the user opened via the "Open with" picker — navigating to a file in Drive does not satisfy it. Use `drive` scope. For local/unpacked use no Web Store review is required.

### Token flow

`chrome.identity` is only available in the service worker. All token operations go through message passing.

```typescript
// service-worker.ts
let tokenPromise: Promise<string> | null = null;

async function getToken(interactive: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) reject(chrome.runtime.lastError);
      else resolve(token);
    });
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg.type === 'GET_TOKEN') {
    if (!tokenPromise) {
      tokenPromise = getToken(false)
        .catch(() => getToken(true))
        .finally(() => { tokenPromise = null; });
    }
    tokenPromise.then(token => respond({ token })).catch(err => respond({ error: err.message }));
    return true;
  }
  if (msg.type === 'REMOVE_TOKEN') {
    chrome.identity.removeCachedAuthToken({ token: msg.token }, () => respond({}));
    return true;
  }
});
```

```typescript
// driveApi.ts
async function apiFetch(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const { token, error } = await chrome.runtime.sendMessage({ type: 'GET_TOKEN' });
  if (error) throw new Error(error);
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
  });
  if (res.status === 401 && retry) {
    await chrome.runtime.sendMessage({ type: 'REMOVE_TOKEN', token });
    return apiFetch(url, init, false);
  }
  if (!res.ok) throw new Error(`Drive API error ${res.status}: ${await res.text()}`);
  return res;
}
```

---

## Rendering

| Library | Loaded | Purpose |
|---------|--------|---------|
| `marked` ^13 | Eager | Markdown → HTML |
| `katex` ^0.16 | Eager | Math rendering |
| `highlight.js` ^11 | Eager | Syntax highlighting (import only needed languages) |
| `mermaid` ^11 | Lazy (dynamic import) | Diagram rendering |
| `@codemirror/*` ^6 | Eager | Editor |

Eager bundle: ~1–1.2 MB. Mermaid adds ~1.5 MB on first diagram, cached thereafter.

```typescript
// render.ts
import { marked, type TokenizerExtension, type RendererExtension } from 'marked';
import katex from 'katex';
import hljs from 'highlight.js/lib/core';
// import individual languages: hljs.registerLanguage(...)

const mathExtension: TokenizerExtension & RendererExtension = { /* ... */ };
marked.use({ extensions: [mathExtension] });
marked.use({ renderer: { code({ text, lang }) {
  if (lang === 'mermaid') {
    // Encode graph definition in a data attribute; renderMermaid() picks it up post-render
    return `<div class="mermaid-pending" data-graph="${encodeURIComponent(text)}"></div>`;
  }
  const highlighted = lang && hljs.getLanguage(lang)
    ? hljs.highlight(text, { language: lang }).value
    : text;
  return `<pre><code class="hljs language-${lang ?? ''}">${highlighted}</code></pre>`;
}}});

export function renderMarkdown(src: string): string {
  return marked.parse(src) as string;
}
```

Math extension tokenizes `$$...$$` (block) and `$...$` (inline) before marked processes them, renders via `katex.renderToString(..., { throwOnError: false })`.

### Mermaid

Mermaid is loaded as a dynamic import to keep the initial bundle lean (~1.5MB if bundled eagerly). It runs after the preview DOM commits, alongside `positionComments`.

```typescript
// render.ts
let mermaidPromise: Promise<typeof import('mermaid')> | null = null;

function getMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(m => {
      m.default.initialize({ startOnLoad: false, theme: 'neutral' });
      return m;
    });
  }
  return mermaidPromise;
}

export async function renderMermaidBlocks(container: HTMLElement): Promise<void> {
  const pending = container.querySelectorAll<HTMLElement>('.mermaid-pending');
  if (!pending.length) return;
  const { default: mermaid } = await getMermaid();
  await Promise.all(Array.from(pending).map(async (el, i) => {
    const graph = decodeURIComponent(el.dataset.graph ?? '');
    try {
      const { svg } = await mermaid.render(`mermaid-${i}-${Date.now()}`, graph);
      el.innerHTML = svg;
      el.classList.replace('mermaid-pending', 'mermaid-diagram');
    } catch {
      el.textContent = graph; // fall back to raw source on parse error
      el.classList.replace('mermaid-pending', 'mermaid-error');
    }
  }));
}
```

Call `renderMermaidBlocks` in `Preview.tsx` inside the same `useEffect` that triggers after `renderedHtml` commits, alongside the `positionComments` call in `Gutter`:

```typescript
// Preview.tsx
useEffect(() => {
  requestAnimationFrame(() => {
    if (previewRef.current) renderMermaidBlocks(previewRef.current);
  });
}, [renderedHtml.value]);
```

**Mermaid in the shadow DOM:** `mermaid.render()` returns an SVG string and does not require DOM access during rendering — it only needs a temporary detached element. This avoids the shadow DOM isolation issues that `mermaid.run()` (which mutates live DOM nodes) would have. The `id` parameter passed to `mermaid.render()` must be unique per call; use a counter or timestamp suffix as shown above.

**Theme:** `theme: 'neutral'` works for both light and dark backgrounds. If a dark panel theme is active, switch to `theme: 'dark'` in `initialize()`. Expose this as a parameter from the panel's theme state.

### CSS in the Shadow DOM

At build time, a small esbuild plugin converts CSS files imported with a `?raw` suffix into exported string constants. Add the plugin to `build.mjs`:

```javascript
const rawCssPlugin = {
  name: 'raw-css',
  setup(build) {
    build.onLoad({ filter: /\.css\?raw$/ }, async (args) => {
      const css = await fs.promises.readFile(args.path.replace('?raw', ''), 'utf8');
      return { contents: `export default ${JSON.stringify(css)}`, loader: 'js' };
    });
  },
};
// add to shared: plugins: [rawCssPlugin]
```

Then `injectStyles` in `index.ts`:

```typescript
import katexCss   from 'katex/dist/katex.min.css?raw';
import hljsCss    from 'highlight.js/styles/github.css?raw';
import githubMd   from 'github-markdown-css/github-markdown-light.css?raw';
import panelCss   from '../styles/panel.css?raw';

function injectStyles(shadow: ShadowRoot) {
  const style = document.createElement('style');
  style.textContent = githubMd + katexCss + hljsCss + panelCss;
  shadow.appendChild(style);
}
```

KaTeX's minified CSS embeds fonts as data URIs — no external font requests needed.

---

## Styling

### Approach

All colours, typography, and spacing are defined as CSS custom properties on `:host` in `panel.css`. Nothing else in the stylesheet uses literal colour values — only `var(--token)`. Changing the theme means changing the token definitions at the top of `panel.css`, nothing else.

### Prose rendering

Use the `github-markdown-css` package (`npm install github-markdown-css`). Apply `class="markdown-body"` to the preview container div. This handles all prose elements (`h1`–`h6`, `p`, `blockquote`, `table`, `ul`, `code`, etc.) with sensible defaults. Override its internal CSS variables to integrate with the panel theme:

```css
.markdown-body {
  --color-canvas-default:  var(--color-bg);
  --color-canvas-subtle:   var(--color-surface);
  --color-border-default:  var(--color-border);
  --color-fg-default:      var(--color-text);
  --color-fg-muted:        var(--color-text-muted);
  --color-accent-fg:       var(--color-accent);
  font-family: var(--font-prose);
  font-size: var(--font-size-base);
  max-width: 72ch;
  margin: 0 auto;
  padding: 2rem;
}
```

### Syntax highlighting

Use `highlight.js/styles/github.css` (light). Switch to `github-dark.css` in dark mode.

### Token definitions

Defined once on `:host` in `panel.css`:

```css
:host {
  /* Backgrounds */
  --color-bg:             #ffffff;
  --color-surface:        #f6f8fa;

  /* Borders */
  --color-border:         #d0d7de;
  --color-border-muted:   #e8ecf0;

  /* Text */
  --color-text:           #1f2328;
  --color-text-muted:     #636c76;
  --color-text-inverse:   #ffffff;

  /* Accent */
  --color-accent:         #0969da;
  --color-accent-hover:   #0550ae;

  /* Comment cards — warm tint to distinguish from content */
  --color-card-bg:        #fffef0;
  --color-card-border:    #d4a017;
  --color-card-resolved:  #f6f8fa;

  /* Danger */
  --color-danger:         #cf222e;

  /* Typography */
  --font-ui:              system-ui, -apple-system, sans-serif;
  --font-prose:           system-ui, -apple-system, sans-serif;
  --font-mono:            ui-monospace, 'Cascadia Code', monospace;
  --font-size-base:       15px;
  --font-size-sm:         13px;

  /* Spacing */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;

  /* Radii */
  --radius-sm: 4px;
  --radius-md: 6px;

  /* Shadows */
  --shadow-card: 0 1px 3px rgba(0,0,0,0.12);
}
```

### Panel chrome

```css
.toolbar {
  background: var(--color-bg);
  border-bottom: 1px solid var(--color-border);
  font-family: var(--font-ui);
  font-size: var(--font-size-sm);
  color: var(--color-text);
  padding: 0 var(--space-4);
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.gutter {
  background: var(--color-surface);
  border-left: 1px solid var(--color-border-muted);
}

.comment-card {
  background: var(--color-card-bg);
  border: 1px solid var(--color-card-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-card);
  font-family: var(--font-ui);
  font-size: var(--font-size-sm);
  padding: var(--space-3);
  position: absolute;
  width: calc(220px - var(--space-4) * 2);
}
.comment-card.resolved {
  background: var(--color-card-resolved);
  border-color: var(--color-border-muted);
  opacity: 0.7;
}

.drag-handle { background: var(--color-border-muted); transition: background 150ms; }
.drag-handle:hover { background: var(--color-accent); }

.unsaved-dot { color: var(--color-danger); }

.btn-primary {
  background: var(--color-accent);
  color: var(--color-text-inverse);
  border: none;
  border-radius: var(--radius-sm);
  padding: var(--space-1) var(--space-3);
  font-family: var(--font-ui);
  font-size: var(--font-size-sm);
  cursor: pointer;
}
.btn-primary:hover { background: var(--color-accent-hover); }

.btn-ghost {
  background: transparent;
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: var(--space-1) var(--space-3);
  font-family: var(--font-ui);
  font-size: var(--font-size-sm);
  cursor: pointer;
}
.btn-ghost:hover { color: var(--color-text); border-color: var(--color-text-muted); }
```

### Dark theme

Redefine only the tokens — all other rules inherit automatically:

```css
:host(.dark) {
  --color-bg:            #0d1117;
  --color-surface:       #161b22;
  --color-border:        #30363d;
  --color-border-muted:  #21262d;
  --color-text:          #e6edf3;
  --color-text-muted:    #7d8590;
  --color-accent:        #58a6ff;
  --color-accent-hover:  #79c0ff;
  --color-card-bg:       #1c1e14;
  --color-card-border:   #9e6a03;
  --color-card-resolved: #161b22;
}
```

### Additional package

```
github-markdown-css
```

---

## Editor

```typescript
// Editor.tsx
import { useEffect, useRef } from 'preact/hooks';
import { EditorView, keymap } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { markdown as markdownSignal, unsaved } from './state';

export function Editor() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const view = new EditorView({
      doc: markdownSignal.value,
      extensions: [
        markdown(),
        keymap.of([...defaultKeymap, indentWithTab]),
        EditorView.updateListener.of(update => {
          if (update.docChanged) {
            markdownSignal.value = update.state.doc.toString();
            unsaved.value = true;
          }
        }),
      ],
      parent: ref.current!,
    });
    return () => view.destroy();
  // Re-mount the editor when fileId changes (user navigated to a different .md file).
  // This ensures CodeMirror picks up the new file's content rather than showing stale content.
  }, [fileId.value]);

  return <div ref={ref} class="editor-container" />;
}
```

Vim mode: add `vim()` from `@replit/codemirror-vim`, gated on a toggle in `chrome.storage.sync`.

---

## Build

```javascript
// build.mjs
import * as esbuild from 'esbuild';
import fs from 'fs';

const dev = process.argv.includes('--watch');
const shared = {
  bundle: true,
  minify: !dev,
  sourcemap: dev ? 'inline' : false,
  jsxImportSource: 'preact',
  jsx: 'automatic',
};

if (dev) {
  // esbuild.build() does not support watch — must use context API
  const [ctxContent, ctxSw] = await Promise.all([
    esbuild.context({ ...shared, entryPoints: ['src/content/index.ts'],          outfile: 'dist/content.bundle.js', format: 'iife' }),
    esbuild.context({ ...shared, entryPoints: ['src/background/service-worker.ts'], outfile: 'dist/sw.bundle.js',      format: 'esm'  }),
  ]);
  await Promise.all([ctxContent.watch(), ctxSw.watch()]);
  console.log('watching...');
} else {
  await Promise.all([
    esbuild.build({ ...shared, entryPoints: ['src/content/index.ts'],          outfile: 'dist/content.bundle.js', format: 'iife' }),
    esbuild.build({ ...shared, entryPoints: ['src/background/service-worker.ts'], outfile: 'dist/sw.bundle.js',      format: 'esm'  }),
  ]);
  fs.copyFileSync('src/manifest.json', 'dist/manifest.json');
  fs.cpSync('src/icons', 'dist/icons', { recursive: true });
}
```

```json
"scripts": {
  "build": "node build.mjs",
  "dev": "node build.mjs --watch"
}
```

---

## Manifest

```json
{
  "manifest_version": 3,
  "name": "Drive Markdown",
  "version": "0.1.0",
  "description": "Render and edit .md files in Google Drive with native comments.",
  "permissions": ["identity", "storage", "webNavigation"],
  "host_permissions": [
    "https://drive.google.com/*",
    "https://www.googleapis.com/*"
  ],
  "oauth2": {
    "client_id": "<client-id>.apps.googleusercontent.com",
    "scopes": ["https://www.googleapis.com/auth/drive"]
  },
  "content_scripts": [
    {
      "matches": ["https://drive.google.com/*"],
      "js": ["content.bundle.js"],
      "run_at": "document_idle"
    }
  ],
  "background": {
    "service_worker": "dist/sw.bundle.js",
    "type": "module"
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

---

## Implementation Order

Implement in this sequence. Each phase should be independently testable before moving to the next.

**Phase 1 — Shell.** Panel injection, file detection, mount/unmount, OAuth token flow. No rendering yet — just confirm the panel appears over Drive when a `.md` file is opened, shows a loading state, and disappears on navigation away.

**Phase 2 — Preview.** Fetch file content and metadata, render markdown into the preview column. Full-width (no gutter or editor yet). Confirm KaTeX math, syntax highlighting, and tables render correctly.

**Phase 3 — Comment gutter.** Fetch and display comments as positioned cards. Implement `positionComments`. Add the "Add a comment" bar and quote-on-select flow. Confirm cards align to their quoted text and stack correctly when overlapping.

**Phase 4 — Editor column.** Add the Edit button, drag handle, and CodeMirror editor. Wire save (Ctrl+S + button), unsaved indicator, conflict check, and preview re-render on save.

---

## Google Cloud Setup

1. New project at [console.cloud.google.com](https://console.cloud.google.com)
2. Enable **Google Drive API**
3. OAuth consent screen → External → add your Google account as a test user
4. Credentials → Create → OAuth client ID → **Chrome Extension** → paste the extension ID (visible at `chrome://extensions` after first unpacked load)
5. Copy the client ID into `manifest.json`

---

## Dev Installation

```bash
npm install && npm run build
# Chrome → chrome://extensions → Developer mode → Load unpacked → select dist/
```

---

## Out of Scope

- Firefox (`browser.identity` has a different OAuth flow)
- Wiki-links or cross-file navigation
- Conflict merge UI — show a confirm dialog and let the user decide
- Offline support

---

## Open Questions

1. **Shadow DOM + CodeMirror layout.** CodeMirror measures DOM elements for layout and may behave incorrectly inside a Shadow DOM. Test with an `open` shadow root in Phase 4; if measurements are wrong, fall back to style isolation via a unique CSS class prefix on the injected container instead of a shadow root.

2. **Comment `anchor` field.** Skipped for v1 — `quotedFileContent.value` carries the quoted text for display, but comments float free of their source location after edits. Line-tracked anchors are post-MVP.

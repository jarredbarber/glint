# Chromedown × Glint Integration Proposal

## What each does that the other doesn't

**Chromedown has, Glint doesn't:**
- Chrome extension distribution — renders any `.md` URL in-browser, no server needed
- GitHub backend: view, edit, and commit markdown via OAuth Device Flow
- Google Drive backend
- Generic HTTP backend (any `https://…/*.md`)
- DOMPurify sanitization (necessary for untrusted remote content)
- Callouts / admonitions (`[!NOTE]`, `[!WARNING]`, etc. — GitHub-style)
- Definition lists (`remark-definition-list`)
- Theme and font controls persisted to `chrome.storage.sync`

**Glint has, Chromedown doesn't:**
- Local filesystem serving (Fastify, auth, hot-reload)
- Task and comment widget system with state persistence
- Source-line mapping (`data-source-line`) → inline CodeMirror editing
- Wiki links and image upload
- LRU render cache
- `glint.toml` config, Git storage provider, multi-mount StorageManager
- abcjs music notation
- Equation numbering, sidebar, section extraction

**Already shared (duplicated today):**
- `remarkCitations` / `remark-glint-citations` — same logic, two files
- Unified pipeline shape (`remarkParse → remarkMath → remarkGfm → … → rehypeKatex → rehypeHighlight → rehypeStringify`)

---

## What to merge vs. keep separate

| Part | Recommendation |
|------|----------------|
| `extensions/chromedown/` | Copy verbatim into the Glint monorepo as a peer package; build independently with Vite |
| `src/callouts.ts` | Port into Glint as `src/remark-callouts-glint.ts`; add to server pipeline |
| `src/citations.ts` | Replace both copies with a shared `packages/glint-render/citations.ts` |
| Glint's `remark-*` plugins | Stay in `src/`; Chromedown doesn't need file I/O or widget plugins |
| Chromedown's backends / auth | Stay in `extensions/chromedown/src/`; Glint has no use for them |
| DOMPurify | Chromedown only; Glint trusts local files |

---

## How to wire them together

### 1. Monorepo layout

```
glint/
  src/                       # existing Glint server + plugins
  extensions/
    chromedown/              # verbatim copy of chromedown repo
      package.json           # already has its own build + test
  packages/
    glint-render/            # new shared package (optional — see §3)
  package.json               # workspace root with workspaces: ["extensions/*", "packages/*"]
```

A root `package.json` with `"workspaces"` makes `npm install` at the root wire everything. No build tool changes needed for Glint itself.

### 2. Shared citations plugin (the one concrete coupling)

Extract `remarkCitations` into `packages/glint-render/citations.ts`, re-export the same API. Both `src/server.ts` and `extensions/chromedown/src/render.ts` import from `glint-render/citations`. This eliminates the only duplicated logic.

> If keeping a separate package feels like overkill, the next laziest option is to copy Glint's `remark-glint-citations.ts` into Chromedown and delete `citations.ts`. Divergence is low-risk because the format is Glint-specific anyway.

### 3. Callouts in Glint

Port `extensions/chromedown/src/callouts.ts` → `src/remark-callouts-glint.ts` and insert before `remark-rehype` in `server.ts`. No API surface needed — the plugin is self-contained.

### 4. Glint server as a Chromedown backend (optional)

A `GlintBackend` in Chromedown could hit a local Glint instance's `/f/*?raw=true` endpoint, getting task/comment widgets for local files. This is additive — skip until there's a concrete need.

---

## Breaking changes and migration

None for existing Glint users — the server, CLI, and file format are unchanged.

Chromedown currently lives in a separate repo. After the copy:
- The chromedown repo becomes the canonical source-of-truth until the PR is merged; keep both in sync manually for the transition window, then archive the old repo.
- `npm install` at the Glint root needs Node ≥ 18 (already true for Glint).
- Chromedown's own CI (`vitest`, `tsc`, Vite build) continues running unchanged from `extensions/chromedown/`.

---

## Recommended sequence

1. `cp -r ../chromedown extensions/chromedown` + add workspace entry — done in one commit, verifiable by running `npm run build` inside `extensions/chromedown/`
2. Port callouts into Glint; add a section to `demo.md`
3. Extract shared citations package (or just copy the file)
4. Archive the standalone chromedown repo

Steps 2–4 are independent and can be parallel issues.

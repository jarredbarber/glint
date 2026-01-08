# Glint V1 (MVP) Implementation Tasks

> **Scope**: Rendering, Aesthetics (dark themes), File serving, Browsing UI

---

## ✅ Completed

### Phase 1: Project Setup

- [x] Initialize TypeScript (`tsconfig.json`, dev deps)
- [x] Migrate `server.js` → `src/server.ts`
- [x] Set up CLI with `glint serve [path]`

### Phase 2: Configuration

- [x] Define config schema (`src/config.ts` with Zod)
- [x] Load `glint.json` from content root
- [x] Apply config to server (port, host, theme)

### Phase 3: Theming

- [x] Create `assets/themes/everforest-dark.css`
- [x] Theme injection in HTML template

### Phase 4: Title Extraction

- [x] Parse YAML frontmatter (`gray-matter`)
- [x] Fallback: first `# heading`
- [x] Final fallback: filename

### Phase 5: File Browser UI

- [x] Build file tree scanner (`src/filetree.ts`)
- [x] Create sidebar HTML component
- [x] Update layout (two-column with `layout.css`)

### Phase 6: Index Resolution

- [x] Implement `baseFile` logic for `/` and `/folder/`

### Phase 7: Caching

- [x] Add LRU cache for rendered HTML
- [x] Invalidate on mtime change

### Phase 8: Polish

- [x] `npm run dev` with `tsx watch`
- [x] TypeScript build passing

---

## 🔲 Remaining (Nice to have)

- [ ] Styled 404/500 error pages
- [ ] Manual test: directory traversal security

---

## Stretch Goals (Optional)

- [ ] Image passthrough (relative paths)
- [ ] Mermaid diagrams
- [ ] Inter-note `[[wiki-links]]`

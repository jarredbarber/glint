# Glint Design Specification

**Glint** is a fully self-contained, directory-backed Markdown web server with high-quality math rendering and zero external dependencies or API calls.

## 🧐 Research: Does this already exist?

While many Markdown tools exist, few meet all criteria (Dynamic + Directory-backed + SSR Math + No External Calls) without significant manual configuration.

| Tool | Dynamic? | Directory-backed? | Math (SSR)? | No External Calls? |
| :--- | :--- | :--- | :--- | :--- |
| **mdBook** | No (SSG) | Yes | Yes (via `mdbook-katex`) | Requires manual asset hosting |
| **Gollum** | Yes | Yes (Git-backed) | Yes (via KaTeX) | Requires custom config/flags |
| **MkDocs** | No (SSG) | Yes | No (Client-side) | Defaults to CDNs |
| **HedgeDoc** | Yes | No (Database) | No (Client-side) | Defaults to CDNs |
| **Obsidian** | No (App) | Yes | No (Client-side) | N/A (Local-first app) |

### The Gap

Most viewers default to CDN links for math fonts (KaTeX/MathJax). Creating an "air-gapped" experience usually requires manually downloading assets and overriding templates. **MD-View** fills this gap by bundling everything into a zero-config server.

---

## 🏗 Architecture

### 1. Rendering Pipeline (Unified)

We use the `unified` ecosystem to ensure consistent, extensible rendering:

- `remark-parse` & `remark-math`: Parse MD and recognize `$ ... $` / `$$ ... $$`.
- `remark-rehype` & `rehype-katex`: Convert to HTML AST and **typeset math server-side**.
- `rehype-stringify`: Output the final HTML.

### 2. File Serving

- **Backend**: Fastify (Node.js) using ESM.
- **Dynamic Routing**: A `/*` catch-all route mapping URLs to the `content/` directory.
- **Security**: Hardened path resolution to prevent directory traversal.
- **Caching** (LRU):
  - Cache rendered HTML files; invalidate on file updates.
  - Cache individual equations; need to investigate equation rendering time. it's very slow on other platforms like hackmd.io.

### 3. Assets & Theming

- **Local KaTeX**: Bundled in `assets/katex/` to avoid external calls.
- **CSS Themes**: Simple, responsive themes in `assets/themes/`.

### 4. Web UI

- Pages at `/path/file.md`
- Left-side tree browser for browsing files
- Page title, in order:
  - YAML frontmatter `title:`
  - First `#` section
  - Filename

### 5. CLI & Configuration

- Question: Can CLI be "compiled" into a minimal-dependency package for distribution?
- Server launched with a path to the content files: `glint serve /path/to/notes` (default: $PWD)
- Configuration is done via an (optional) `glint.json` file in the content root directory.
  - Store defaults in `config.ts` and overwrite with glint.json if available.
- Configuration schema:

```json
{
   "port": "3000",
   "baseFile": "README.md", // what happens accessing / or /folder
   "host": "0.0.0.0", // or whatever this is supposed to be
   "theme": "everforest-dark"
}
```

## Roadmap

CRITICAL: DO NOT IMPLEMENT ANYTHING BEYOND V1. V2+ features are handled well by external tools and will only be implemented if the value exceeds the complexity.

### V1: MVP

- Rendering
- Aesthetics (themes/CSS)
  - Config only for now
  - Light/dark as separate themes. Only care about dark right now.
- File serving
- Browsing UI

Stretch goals:

- Images (using relative paths in content directory)
- Diagrams
- Inter-note links
- Latex features. These may need to be re-scoped a bit because we aren't running a full latex engine.
  - `$$$ ... $$$` goes into align mode
  - Custom latex macros in glint.json:

```json
   {
      ...
      "latex-macros": {
         "R": "\\mathbb{R}",
         "trace": "\\operatorname{Tr}\{#1\}"
      }
   }
```

- Filetype highlighting (json, python, bash, markdown at least)
- Turn on / off equation numbers, maybe via frontmatter `eqn-numbers: true`? off by default. Syntax `$$*` or `$$$*` turns off eqn numbers if they are enabled.
- File outliner in left panel.
- Anchor links to subsections.

#### MVP polish

After each feature is done, push to github.

- add "indent guides" for sections to help visually separate sections.
- visually separate out folders from files in the FILES drawer
- auto-reload on glint.json update
- expand/collapse the files and outlines drawers

### V2: Editing

See SPEC_V2.md

### V3: Multi-user service

Serve multiple users with permissions / sharing; concurrent editing.

# MD-View Design Specification

A self-contained, directory-backed Markdown web server with high-quality math rendering and zero external dependencies.

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

### 3. Assets & Theming

- **Local KaTeX**: Bundled in `assets/katex/` to avoid external calls.
- **CSS Themes**: Simple, responsive themes in `assets/themes/`.

---

## 🚀 Deployment & Usage

### Local Setup

1. Place markdown files in the `content/` folder.
2. Run the server:

   ```bash
   node server.js
   ```

3. Access at `http://localhost:3000`.

### Configuration

- **Port**: Default is `3000`.
- **Content Root**: The `content/` directory relative to `server.js`.

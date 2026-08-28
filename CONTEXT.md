# Glint context

## Glossary

- **Source** — a backend-owned collection of Markdown files opened by the SPA.
- **File** — Markdown bytes plus a backend-native version token; the source owns its identity and access control.
- **Storage Adapter** — the seam that gives the SPA file operations for one Source.
- **Discussion** — backend-owned commentary about a file; it is not part of that file's Markdown bytes.
- **Project** — a browser-local bookmark to a Source, never a copy, account, or permission object.
- **Theme** — the layout, type, and ornament axis of the reading surface (Reader, Almanac). Set on the root as `data-theme`; the color scheme is orthogonal. (Formerly called "skin".)
- **Color scheme** — the colour palette applied to a theme (nord, one-dark, and the rest). Swapped by loading one `assets/color-schemes/<name>.css` file. (Formerly called "theme".)
- **OG Glint** — Glint before the SPA port: the standalone single-file HTML renderer (`glint-md render`) with no storage adapters, projects, or browser app shell. Preserved on the `og-glint` branch at commit `5d8342b` (the last commit before any `src/spa/` code). Referenced when a behavior we want to bring back originated there.

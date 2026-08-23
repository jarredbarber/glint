# Glint context

## Glossary

- **Source** — a backend-owned collection of Markdown files opened by the SPA.
- **File** — Markdown bytes plus a backend-native version token; the source owns its identity and access control.
- **Storage Adapter** — the seam that gives the SPA file operations for one Source.
- **Discussion** — backend-owned commentary about a file; it is not part of that file's Markdown bytes.
- **Project** — a browser-local bookmark to a Source, never a copy, account, or permission object.

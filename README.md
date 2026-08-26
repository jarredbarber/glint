# Glint

Glint is a privacy-first Markdown viewer, editor, and wiki. The browser app opens Markdown from a local folder, Google Drive, or a GitHub repository; files remain in their selected backend.

<img width="854" height="730" alt="Demo Screenshot" src="https://github.com/user-attachments/assets/2865c87f-6f21-42c8-a082-ad5b825cb0ba" />

[Live Demo Site](https://jarredbarber.github.io/glint/#/demo)


## Capabilities

- Opinionated rendering of Markdown with extensions geared towards technical writing 
  - Standard Github-flavored Markdown
  - Syntax highlighted code blocks
  - LaTeX equations (inline + display mode)
  - [Mermaid](https://mermaid.js.org/) diagrams
  - [ABCjs](https://www.abcjs.net/) music notation
  - Task lists
  - Wiki links
  - References / Citations
  - [Supported Markdown agent skill](https://jarredbarber.github.io/glint/llm.txt)
- In-place editing and commenting (on supported backends)
- Paste-based image uploading: paste an image into the editor to store it as a portable sidecar beside the page (`page.md.<id>.png`)
- Export the current page from the SPA, or
- Offline rendering to portable HTML with `glint render` CLI.
- Offline markdown processor for e.g. [VimR](https://github.com/qvacua/vimr) via `glint render --stdin --body-only`

## Getting started

Glint is hosted at https://jarredbarber.github.io/glint. It is entirely browser-based

| Source | Route | Requirement |
| --- | --- | --- |
| Demo | `#/demo` | None |
| Local folder | `#/local` | Chromium or Edge File System Access API |
| Google Drive | `#/drive/<folderId>` | Public Drive OAuth client ID in `src/spa/config.js` |
| GitHub | `#/gh/<owner>/<repo>` or `#/gh/<owner>/<repo>/tree/<ref>/<path>` | Fine-grained GitHub token entered in the browser |
| GitHub single file | `#/gh/<owner>/<repo>/blob/<ref>/<path>` | Same GitHub token |
| Single file (Drive/demo) | `#/s/drive/<fileId>` or `#/s/demo/<page>` | Same as the underlying source |

GitHub routes mirror github.com's own URL shape, so pasting a `github.com/<owner>/<repo>/blob/<ref>/<path>` link opens that one file read-only; a `tree` link (or a bare repo URL) opens the folder as a project. Drive `.../file/d/<id>` links open a single file; `.../folders/<id>` links open a folder. The landing page has one box that takes any of these links (or the short `owner/repo/...` form) and detects the source; the **copy-link** button in the sidebar page actions builds the shareable single-file URL for the current page.

**Settings** (top of any workspace) exposes two independent appearance axes — a **skin** (Reader, warm editorial; or Almanac, printed field-guide) that sets layout and typography, and a **palette** (18 colour themes) that sets colour. Any skin renders under any palette, light or dark. A **Layout** section chooses where comments go — **inline** (anchored beneath the source line) or a **side rail** — and toggles an optional page **top bar** (breadcrumb, export, delete). Settings also holds the Vim-keybindings toggle and per-project management: saved projects carry an editable display **name** (rename there), so a long Drive folder ID never overflows the sidebar. Comments are written with an inline compose box, and GitHub credentials are entered through an in-app dialog and kept in memory only. Resolved comment threads collapse behind a "Show resolved" toggle so active discussion stays uncluttered. When a page has more than one heading, the sidebar shows an "On this page" outline that tracks your reading position. Read-only sources (for example a GitHub token without push access) hide the Save and page-editing controls.

## Offline rendering

Install the CLI:
```bash
npm run build
npm link

glint render notes/paper.md
glint render notes/paper.md --output output.html --theme nord

# Piped mode for use as a markdown processor
cat notes/paper.md | glint render --stdin --body-only 
```

## Development / contribution

We use a very agent-heavy process; see [AGENTS.md](AGENTS.md) for workflows and [docs/spa-setup.md](docs/spa-setup.md) for deployment.


```
npm install
npm run build
```

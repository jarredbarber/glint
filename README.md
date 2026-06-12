
# Glint

A self-contained Markdown server with math rendering and zero external dependencies.

$$G_{\mu\nu} + \Lambda g_{\mu\nu} = \frac{8\pi G}{c^4} T_{\mu\nu}$$

## Features

- **No-Build**: Just run `glint serve` on any directory.
- **Live Reload**: Updates instantly when you save.
- **Math First**: Full LaTeX support via KaTeX (server-side rendering, no JS required).
- **Diagrams**: Mermaid support via fenced code blocks with language `mermaid`.
- **Wiki-links**: Use `[[Note Name]]` or `[[Note Name|Label]]` to link pages.
- **Citations**: Inline `[[#ref:id]]` syntax with hover cards and click-to-scroll bibliography.
- **Interactive Widgets**:
  - **Tasks**: `- [ ]` checkboxes with states (`x`, `/`, `w`, `b`, `c`) and metadata (`due:`, `@assignee`, `#priority`).
  - **Comments**: ` ```comment ` blocks for threaded discussions with markdown support.
  - **Keyboard Shortcuts**: Press `e` to edit any section, `c` to insert a comment block.
- **Inline Editor**: Click any section to edit it in place with CodeMirror (vim mode available).
- **File Outliner**: Automatic table of contents for long documents.
- **Task View**: Aggregated task dashboard across all files.
- **Journal View**: Chronological stream of dated entries (`## YYYY-MM-DD` headings) across your entire folder.
- **Static Export**: `glint render <file.md>` produces a single self-contained HTML file with inlined fonts, images, and styles — no server required.
- **Themes**: Built-in dark and light themes, switchable live.

## LLM Instructions

When adding citations to a Glint document, use the inline syntax `[[#ref:id]]` to reference items defined in a `## References` section at the bottom of the document. Each reference should be a list item in the format `- [ref:id] "Title" Author (Year) URL`. Citations automatically render as numbered superscripts with hover previews showing the full reference, and clicking a citation scrolls to the corresponding bibliography entry.

## Installation

```bash
git clone https://github.com/you/glint.git
cd glint
npm install
npm run build
npm link        # or: npm install -g .
```

## Usage

```bash
# Serve current directory
glint serve

# Serve a specific directory or config file
glint serve /path/to/notes
glint serve my-config.toml

# Render a single file to a self-contained HTML file
glint render notes/paper.md
glint render notes/paper.md -o output.html --theme nord
```

## Configuration

Create an optional `glint.toml` in your content root (also supports `.glint/config.toml`):

```toml
port = 3000
host = "0.0.0.0"
theme = "nord"
baseFile = "README.md"
```

| Option | Default | Description |
| --- | --- | --- |
| `port` | 3000 | Server port |
| `host` | 0.0.0.0 | Bind address |
| `theme` | `everforest-dark` | CSS theme name |
| `baseFile` | `README.md` | Index file for `/` and `/folder/` |

## Storage

Glint supports multiple storage backends with prefix-based mounts.

```toml
[storage]
default = "local"

[storage.providers.local]
type = "local"
basePath = "."

[storage.providers.notes]
type = "git"
basePath = "/path/to/repo"
autoCommit = true
autoSync = true
syncInterval = 60

[[storage.mounts]]
prefix = "shared"
provider = "notes"
```

### Storage Providers

| Provider | Type | Description |
| --- | --- | --- |
| **Local** | `local` | Plain filesystem. `basePath` defaults to `.` |
| **Git** | `git` | Local filesystem + automatic git commits and sync |
| **GitHub** | `github` | GitHub API (`owner`, `repo`, `branch`, `token`) |

The `git` provider debounces writes and commits 2 seconds after saving. If the repo has a remote, it periodically pulls and pushes (`syncInterval` in seconds).

## Themes

- `everforest-dark` (default) — Balanced, nature-inspired dark theme
- `nord` — Cool, arctic blue
- `gruvbox-dark` — Warm, retro earth tones
- `catppuccin-mocha` — Soft pastel dark
- `solarized-light` — Classic readable light theme

Theme changes in `glint.toml` are picked up live.

## Deployment

Access control is intentionally left to the network layer — run behind a VPN (e.g. Tailscale), SSH tunnel, or a reverse proxy with TLS.

### systemd

```ini
[Unit]
Description=Glint Markdown Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/path/to/notes
ExecStart=/usr/local/bin/node /opt/glint/dist/cli.js serve /path/to/notes
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

### PM2

```bash
pm2 start /opt/glint/dist/cli.js --name glint -- serve /path/to/notes
pm2 save && pm2 startup
```

MIT

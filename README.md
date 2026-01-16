
# Glint

A self-contained Markdown server with math rendering and zero external dependencies.

$$G_{\mu\nu} + \Lambda g_{\mu\nu} = \frac{8\pi G}{c^4} T_{\mu\nu}$$

## Features

- **No-Build**: Just run `glint` on any directory.
- **Git Friendly**: Works great with existing repos.
- **Live Reload**: Updates instantly when you save.
- **Math First**:
  - Full LaTeX support via KaTeX.
- **Diagrams**: Mermaid support (Code blocks with language `mermaid`).
- **Wiki-links**: Use `[[Note Name]]` or `[[Note Name|Label]]` to link pages.
- **Citations**: Inline citations with `[[#ref:id]]` syntax and a `## References` section with hover cards and click-to-scroll.
- **Interactive Widgets**:
  - **Tasks**: `- [ ]` checkboxes with states (`x`, `/`, `w`, `b`) and metadata (`due:`, `@assignee`, `#priority`).
  - **Comments**: ` ```comment ` blocks for multi-user discussions with thread collapsing and markdown support.
  - **Keyboard Shortcuts**: Press `e` to edit any section or `c` to insert a comment block.
- **Beautiful**: Dark mode by default (Everforest), syntax highlighting, and responsive layout.
- **File Outliner**: Automatic table of contents for long documents.
- **Journal View**: Aggregated stream of daily notes and entries across your entire folder.
- **Zero config** — Just point at a directory and go
- **Hot Reload** — Real-time updates via SSE.

## LLM Instructions

When adding citations to a Glint document, use the inline syntax `[[#ref:id]]` to reference items defined in a `## References` section at the bottom of the document. Each reference should be a list item in the format `- [ref:id] "Title" Author (Year) URL`. Citations automatically render as numbered superscripts with hover previews showing the full reference, and clicking a citation scrolls to the corresponding bibliography entry.

## Installation

```bash
# Clone and build
git clone https://github.com/you/glint.git
cd glint
npm install
npm run build

# Install globally
npm link
# or: npm install -g .
```

## Usage

```bash
# Serve current directory
glint serve

# Serving from a configuration file
glint serve my-config.toml

# Development mode (hot reload)
npm run dev
```

## Configuration

Create an optional `glint.toml` in your content root (Glint also supports `.glint/config.toml` and legacy JSON formats):

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
| `theme` | `everforest-dark` | CSS theme name (see below) |
| `baseFile` | `README.md` | Index file for `/` and `/folder/` |

## Authentication

Glint supports optional password protection for your notes.

### Setup

Run the setup command to configure authentication:

```bash
glint setup-auth /path/to/notes
```

This will:

- Prompt for a password (min 8 characters)
- Generate a secure session secret
- Update your `glint.toml` with auth settings

### Auth Settings

After setup, your `glint.toml` will include:

```toml
[auth]
enabled = true
passwordHash = "<bcrypt hash>"
sessionSecret = "<generated secret>"
public = []
```

### Public Paths

Make specific paths accessible without login by adding them to `auth.public`:

```toml
[auth]
enabled = true

[[auth.public]]
path = "docs/**"
access = "view"

[[auth.public]]
path = "README.md"
access = "view"

[[auth.public]]
path = "blog/*"
access = "comment"
```

**Access levels:**

- `view` — Read-only access
- `comment` — Can view and add comments
- `edit` — Full access (same as authenticated)

**Path patterns:**

- `*` — Matches a single path segment
- `**` — Matches multiple path segments

## Storage

Glint supports multiple storage backends and can mount different folders from different providers.

### Storage Settings

Add a `storage` block to your `glint.toml`:

```toml
[storage]
default = "local"

[storage.providers.local]
type = "local"
basePath = "."

[storage.providers.work]
type = "github"
owner = "org-name"
repo = "docs"
branch = "main"
token = "ghp_..."

[[storage.mounts]]
prefix = "shared"
provider = "work"

[storage.cache]
enabled = true
ttl = 300000
maxSize = 104857600
```

### Storage Providers

| Provider | Type | Options |
| --- | --- | --- |
| **Local** | `local` | `basePath` (default: `.`) |
| **GitHub** | `github` | `owner`, `repo`, `branch` (optional), `token` (optional) |
| **Git** | `git` | `basePath`, `autoCommit`, `autoSync`, `syncInterval`, `commitMessage` |

### Git Provider

The `git` provider combines fast local filesystem access with automatic git synchronization. It's ideal for notes stored in a git repository.

```toml
[storage.providers.notes]
type = "git"
basePath = "/path/to/repo"
autoCommit = true      # Auto-commit changes (default: true)
autoSync = true        # Auto-sync with remote (default: true)
syncInterval = 60      # Sync interval in seconds (default: 60)
commitMessage = "Glint auto-save"  # Custom commit message
```

**Behavior:**

- **Auto-commit**: Changes are debounced and committed 2 seconds after writing
- **Auto-sync**: If the repo has a remote origin, Glint periodically pulls and pushes
- **Local-only repos**: If no remote exists, changes are only committed locally
- **Conflict handling**: Uses fast-forward only pulls; conflicts are logged (local changes preserved)

**Comparison with other providers:**

- `local`: Fast, no git integration
- `git`: Fast + automatic git commits and sync (Best for local repos)
- `github`: Uses GitHub API directly (slower, but works without local clone)

## Journal View

Glint includes a built-in **Journal View** that aggregates dated entries from across all your Markdown files into a single, chronological feed.

### Entry Syntax

To register a journal entry, simply use a second-level heading in the format `## YYYY-MM-DD`:

```markdown
# My Project Notes

## 2026-01-15
Finished implementing the git storage provider.

## 2026-01-14
Started working on the journal view improvements.
```

### Accessing the Journal

- Click **Journal View** in the sidebar.
- Navigate to `/journal`.

The Journal View parses all `.md` files in your content directory to find these headings and presents the contents (with full Markdown/KaTeX rendering) in a unified stream, newest first.

### Mounts

The `mounts` array allows you to map URL prefixes to specific storage providers. In the example above, any request to `/shared/*` will be served from the `work` provider (GitHub), while everything else uses the `default` provider.

### Caching

To improve performance, Glint caches rendered HTML in memory.

- `enabled`: Toggle caching (default: `true`)
- `ttl`: Time to live in milliseconds (default: `300000` / 5 minutes)
- `maxSize`: Maximum cache size in bytes (default: `104857600` / 100MB)

## Themes

Glint comes with several high-quality built-in themes:

- `everforest-dark` (Default) — Balanced, nature-inspired dark theme.
- `nord` — Cool, arctic blue aesthetic.
- `gruvbox-dark` — Warm, retro earth tones.
- `catppuccin-mocha` — Soft, modern pastel dark theme.
- `solarized-light` — Classic, highly readable light theme.

To use a theme, update your `glint.toml`. Changes are picked up instantly via Hot Reloading!

## Page Titles

Titles are extracted in order:

1. YAML frontmatter `title:` field
2. First `# heading`
3. Filename

## Deployment

### systemd (Linux)

Create `/etc/systemd/system/glint.service`:

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

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable glint
sudo systemctl start glint
```

### PM2

```bash
npm install -g pm2
pm2 start /opt/glint/dist/cli.js --name glint -- serve /path/to/notes
pm2 save
pm2 startup  # generates startup script
```

MIT

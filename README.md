
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
- **Interactive Widgets**:
  - **Tasks**: `- [ ]` checkboxes with states (`x`, `/`, `w`, `b`) and metadata (`due:`, `@assignee`, `#priority`).
  - **Comments**: ` ```comment ` blocks for multi-user discussions with thread collapsing and markdown support.
  - **Keyboard Shortcuts**: Press `e` to edit any section or `c` to insert a comment block.
- **Beautiful**: Dark mode by default (Everforest), syntax highlighting, and responsive layout.
- **File Outliner**: Automatic table of contents for long documents.
- **Zero config** — Just point at a directory and go
- **Hot Reload** — Real-time updates via SSE.

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

# Serve specific directory
glint serve /path/to/notes

# Development mode (hot reload)
npm run dev
```

## Configuration

Create an optional `glint.json` in your content root:

```json
{
  "port": 3000,
  "host": "0.0.0.0",
  "theme": "everforest-dark",
  "baseFile": "README.md"
}
```

| Option | Default | Description |
| --- | --- | --- |
| `port` | 3000 | Server port |
| `host` | 0.0.0.0 | Bind address |
| `theme` | `everforest-dark` | CSS theme name (see below) |
| `baseFile` | `README.md` | Index file for `/` and `/folder/` |

## Themes

Glint comes with several high-quality built-in themes:

- `everforest-dark` (Default) — Balanced, nature-inspired dark theme.
- `nord` — Cool, arctic blue aesthetic.
- `gruvbox-dark` — Warm, retro earth tones.
- `catppuccin-mocha` — Soft, modern pastel dark theme.
- `solarized-light` — Classic, highly readable light theme.

To use a theme, update your `glint.json`. Changes are picked up instantly via Hot Reloading!

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

### Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY dist ./dist
COPY assets ./assets
EXPOSE 3000
CMD ["node", "dist/cli.js", "serve", "/content"]
```

Build and run:

```bash
docker build -t glint .
docker run -p 3000:3000 -v /path/to/notes:/content glint
```

## License

MIT

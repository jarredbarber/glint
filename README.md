# Glint

[Glint](https://glint.jbarb.io) is a privacy-first Markdown viewer, editor, and wiki. The browser app opens Markdown from a local folder, Google Drive, a GitHub repository, or any raw Markdown URL (read-only); files remain in their selected backend. See [Live Demo Site](https://glint.jbarb.io/#/demo)

<img width="600" alt="Demo Screenshot" src="https://github.com/user-attachments/assets/2865c87f-6f21-42c8-a082-ad5b825cb0ba" />


## Capabilities

- Opinionated rendering of Markdown with extensions geared towards technical writing 
  - Standard Github-flavored Markdown
  - Syntax highlighted code blocks
  - LaTeX equations (inline + display mode), with labeled equations and `[[#eq:key]]` cross-references
  - [Mermaid](https://mermaid.js.org/) diagrams and [TikZ](https://tikz.dev/) pictures (compiled to SVG in the browser)
  - Sanitized semantic HTML plus sandboxed custom HTML blocks
  - Task lists
  - Wiki links
  - References / Citations
  - [Supported Markdown agent skill](https://glint.jbarb.io/llm.txt)
- In-place editing (hit `e` to edit the section under the mouse cursor) and commenting (on supported backends)
- Paste-based image uploading: paste an image into the editor to store it as a portable sidecar beside the page (`page.md.<id>.png`)
- Raw `.html` files in a workspace are listed alongside pages and shown verbatim in a sandboxed iframe (markup, CSS, and images render; page scripts do not run)
- Export the current page from the SPA, or
- Offline rendering to portable HTML with the `glint-md render` CLI.
- Offline markdown processor for e.g. [VimR](https://github.com/qvacua/vimr) via `glint-md render --stdin --body-only`

## Getting started

Glint is hosted at https://glint.jbarb.io. It is entirely browser-based, so there's no need to run it locally or deploy it.

Glint supports either single files or "projects"; a project is a local folder, Google Drive folder, or GitHub repo. Drive/Github files/projects can be accessed by pasting their URLs into the landing page.

### Running it fully local

If your environment won't let the hosted site open a local folder (e.g. a corp policy that blocks sending local data to `glint.jbarb.io`), run the same SPA from your own machine — all origins and data stay local:

```bash
npm install --global glint-md
glint-md app          # serves http://localhost:8080/#/local and opens a browser
glint-md app --port 3000 --no-open
```

## Offline rendering

Install the CLI:
```bash
npm install --global glint-md

glint-md render notes/paper.md
glint-md render notes/paper.md --output output.html --color-scheme nord

# Piped mode for use as a markdown processor
cat notes/paper.md | glint-md render --stdin --body-only

# Print the Glint Markdown extension reference
glint-md --skill
```

## Development / contribution

We use a very agent-heavy process; see [AGENTS.md](AGENTS.md) for workflows and [docs/spa-setup.md](docs/spa-setup.md) for deployment.

```
npm install
npm run build
```

## Publishing the CLI

Package maintainers publish `glint-md` from a clean `main` checkout:

```bash
npm install
npm test
npm run build
npm pack --dry-run
npm login
npm version <patch|minor|major>
npm publish
git push --follow-tags
```

Check the dry-run manifest before changing the version: it should contain `dist/`, the renderer styles under `assets/`, and the `glint-md` executable. `npm publish` runs the `prepack` TypeScript build; it does not publish the SPA.

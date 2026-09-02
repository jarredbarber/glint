# Glint contributor guide

## Product

Glint is a static Markdown wiki plus a single-file HTML renderer. The SPA uses `StorageAdapter` implementations for local folders, Google Drive, GitHub, and an in-memory fake backend. It renders Markdown in the browser with the shared remark/rehype pipeline; it has no Glint server, user database, or live-reload channel.

## Commands

```bash
npm run build       # Type-check and bundle editor, renderer, and SPA
npm test            # Run the Node test suite
npm run dev         # Build, stage dist-spa/, and serve http://localhost:8080
npm run stage:spa   # Assemble the GitHub Pages deploy root
npm run bundle      # Rebuild browser assets without type-checking
npm run start       # Alias for npm run dev
glint-md render FILE # Render one Markdown file to self-contained HTML
glint-md app        # Serve the SPA from localhost (fully-local #/local, no hosted origin)
glint-md --skill    # Print the Glint Markdown skill/reference to stdout
```

The Markdown extension reference lives in `skills/glint-markdown/SKILL.md` (published as `/llm.txt` at deploy time).

## Architecture

- `src/pipeline.ts` is the shared Markdown processor. Keep render behavior here rather than creating a second renderer.
- `src/browser.ts` exports the browser-safe `GlintRender` bundle used by `src/spa/app.ts`.
- `src/spa/storage/types.ts` defines the adapter seam. `id` is the backend read/write key, `path` is source-root-relative for navigation, and `version` is the backend concurrency token.
- `src/spa/editor/session.ts` edits one document section and saves through the active adapter. Conflicts and expired authentication are explicit states.
- `src/render.ts` and `src/cli.ts` retain the standalone `glint-md render` surface; it produces one portable HTML file.
- `assets/` contains checked-in CSS and generated browser bundles. `npm run build` regenerates the bundles.

## SPA development

Use a hash route while running `npm run dev`:

- `#/demo` — in-memory demo; use it for browser smoke tests.
- `#/local` — local directory via the File System Access API (Chromium/Edge).
- `#/drive/<folderId>` — Drive folder; needs `driveClientId`, `drivePickerKey`, and numeric `driveAppId` (Google Cloud project number) in `src/spa/config.js`. Scope is `drive.file` (#92): the route handler probes the folder and opens the Google Picker to authorize it when needed (picking a folder cascades to descendants).
- `#/gh/<owner>/<repo>/<path>` — GitHub subtree; prompts for a fine-grained token and stores it in browser local storage.

The deploy root is `dist-spa/`: `index.html`, `config.js`, `llm.txt`, and `assets/`. `.github/workflows/pages.yml` stages this same layout before publishing.

## Change rules

- Preserve source-root-relative `FileMeta.path` values. Folder navigation, wiki rendering, and all adapters rely on it.
- Keep storage adapters backend-native: do not add a proxy or a Glint credential store.
- Test observable adapter and editor behavior. For SPA UI changes, smoke test `#/demo` in a browser.
- Substantial UI changes may need a pass over the screenshot scenario table in `scripts/ui-shots.ts` (`SCENARIOS`, run via `npm run ui:shots`). Add or update a scenario when you introduce a new widget type or Markdown feature (needs a demo page that exercises it), restructure the demo pages (routes in the table go stale), add a setting that changes rendering (may need a new config variant, or `full: true` if it's theme/palette-sensitive), or add a UI component/layout worth a dedicated shot. The comment/hamburger scenarios drive the live UI, so renamed buttons or selectors break their `act` steps.
- Update `README.md`, `docs/spa-setup.md`, and `skills/glint-markdown/SKILL.md` when changing user-facing routes, storage behavior, or Markdown syntax.
- Commit and push directly to `main`. Do not open pull requests for routine work.

---
**NOTE**: When running `/init`, do not update anything below this line


## AGENT INSTRUCTIONS

### Issue tracker

Issues live in GitHub Issues for `jarredbarber/glint`; use the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Four orthogonal axes: state (`needs-triage`, `ready-for-agent`), human gate (`needs-info`/`needs-action`/`needs-decision`/`needs-lgtm`), category (`bug`/`feat`/`chore`), plus `epic` (container) and `backlog` (parked) flags. `/triage` is intake, `/ready` is execution. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: `CONTEXT.md` + `docs/adr/` at repo root. See `docs/agents/domain.md`.

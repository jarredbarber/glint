# Glint SPA — setup & deploy

The SPA is a static site (`src/spa/`). It points at a backend via the URL hash and
becomes a wiki. No server, no Glint user database — access control is the backend's.

## Workspace URLs

| Backend | Hash route | Needs |
|---------|-----------|-------|
| Local dir | `#/local` | Chromium/Edge (File System Access API); no credentials |
| Google Drive | `#/drive/<folderId>` | `driveClientId` |
| GitHub repo | `#/gh/<owner>/<repo>/<path>` (optional `...@<ref>`) | a pasted fine-grained PAT |
| Demo (in-memory) | `#/fake` | nothing |

## Local dev

```bash
npm run dev
# open http://localhost:8080/#/fake
```

`npm run dev` type-checks, rebuilds browser bundles, stages the deploy layout in
`dist-spa/`, and serves it. Run `npm run stage:spa` after `npm run build` when
you only need the deploy artifact.

## OAuth client IDs (public — not secrets)

Copy `src/spa/config.example.js` → `src/spa/config.js` and fill in:

```js
window.GLINT_CONFIG = { driveClientId: '...', githubClientId: '...' };
```

Commit `config.js` to enable Drive/GitHub on the deployed site (client IDs are public identifiers).

### Google (Drive)

1. Google Cloud Console → APIs & Services → Credentials → **OAuth client ID** → Web application.
2. **Authorized JavaScript origins** = your Pages origin (e.g. `https://<user>.github.io`). OAuth needs a
   real origin — `localhost` works for dev (not `file://`, and `localhost` ≠ `127.0.0.1` to Google).
3. OAuth consent screen in **Testing** mode + add yourself as a test user (zero verification needed).
4. Scope used: `drive.file` (least privilege). The app recursively lists Markdown files below the folder id.
5. Enable the **Google Drive API** for the project.

### GitHub — fine-grained PAT (no OAuth App)

Device flow was dropped: `github.com/login/*` sends no CORS headers, so a browser can't acquire the
token. `api.github.com` *does* allow CORS, so read/write with a token works from the static page —
the token is just pasted rather than obtained via OAuth. No `config.js` entry, no server, no proxy.

1. github.com → Settings → Developer settings → **Fine-grained tokens** → Generate new token.
2. **Repository access:** only the repo(s) you'll edit. **Permissions → Contents: Read and write.**
   (A classic token with the `repo` scope also works.)
3. On first `#/gh/...` load the app prompts for the token, validates it against `api.github.com/user`,
   and caches it in `localStorage`. Commits are attributed to the token's user.

> The token lives only in the browser's `localStorage` (never committed, never sent anywhere but GitHub).
> Set a short expiry and re-paste when it lapses.

## Deploy (GitHub Pages)
`.github/workflows/pages.yml` builds on push to `main`, runs `npm run stage:spa`,
and publishes `dist-spa/` (`index.html`, `config.js`, `llms.txt`, and `assets/`).
Enable Pages → Source: **GitHub Actions** in repository settings.

After deploy, register the Pages origin as the Google **Authorized JS origin** (step 2 above) and
run one round-trip on the live site (auth → list → open → edit → save → persist).

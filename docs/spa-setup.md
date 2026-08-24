# Glint SPA — setup & deploy

The SPA is a static site (`src/spa/`). It points at a backend via the URL hash and
becomes a wiki. No server, no Glint user database — access control is the backend's.

## Workspace URLs

| Backend | Hash route | Needs |
|---------|-----------|-------|
| Local dir | `#/local` | Chromium/Edge (File System Access API); no credentials |
| Google Drive | `#/drive/<folderId>` | `driveClientId` |
| GitHub repo | `#/gh/<owner>/<repo>/<path>@<ref>` | GitHub OAuth or an explicit fine-grained PAT |
| Demo (in-memory) | `#/demo` | nothing |
| Single file | `#/s/<source>/<path>` | same as the underlying source |

`#/s/...` renders one document read-only with no project tree (single-file sharing, #58). `#/s/gh/<owner>/<repo>/<path>@<ref>` reads the file directly (no recursive listing); the path is repo-root relative. `#/s/demo/<page>` shares a demo page. `local` and `drive` have no path-addressable single-file form. The sidebar page-actions **copy-link** button generates the `#/s/...` URL for the current page.

## Local dev

```bash
npm run dev
# open http://localhost:8080/#/demo
```

`npm run dev` type-checks, rebuilds browser bundles, stages the deploy layout in
`dist-spa/`, and serves it. Run `npm run stage:spa` after `npm run build` when
you only need the deploy artifact.

## OAuth client IDs (public — not secrets)

Copy `src/spa/config.example.js` → `src/spa/config.js` and fill in the public values:

```js
window.GLINT_CONFIG = {
  driveClientId: '...',
  githubClientId: '...',
  githubOAuthWorkerOrigin: 'https://glint-github-oauth.<account>.workers.dev',
  githubRedirectUri: 'https://<user>.github.io/glint/',
};
```

Commit `config.js` to enable Drive/GitHub on the deployed site. Client IDs and Worker origins are public; OAuth client secrets never enter the SPA.

### Google (Drive)

1. Google Cloud Console → APIs & Services → Credentials → **OAuth client ID** → Web application.
2. **Authorized JavaScript origins** = your Pages origin (e.g. `https://<user>.github.io`). OAuth needs a
   real origin — `localhost` works for dev (not `file://`, and `localhost` ≠ `127.0.0.1` to Google).
3. OAuth consent screen in **Testing** mode + add yourself as a test user (zero verification needed).
4. Scope used: `drive.file` (least privilege). The app recursively lists Markdown files below the folder id.
5. Enable the **Google Drive API** for the project.

### GitHub — OAuth Worker, with optional fine-grained PAT

GitHub's authorization-code exchange needs an OAuth App secret, so the SPA redirects through the narrow Cloudflare Worker in `src/github-oauth-worker.ts`. The SPA sends repository traffic directly to `api.github.com`; the Worker only accepts `POST /exchange` from configured origins and never stores/proxies GitHub data.

**1. Create the GitHub OAuth App** (Settings → Developer settings → OAuth Apps → New).

| Field | Value |
|-------|-------|
| Homepage URL | your SPA origin, e.g. `https://<user>.github.io/glint/` |
| **Authorization callback URL** | must exactly equal `githubRedirectUri` — the deployed SPA URL, e.g. `https://<user>.github.io/glint/` (include the trailing path; GitHub matches it exactly) |

Register the client ID; generate a client secret. The app requests the broad `repo` scope.

**2. Deploy the Worker and set its config** (from the repo root):

```bash
wrangler deploy --config wrangler.github-oauth.toml
# Client secret — secret, never committed or echoed:
wrangler secret put GITHUB_OAUTH_CLIENT_SECRET --config wrangler.github-oauth.toml
# The three non-secret values (also via secret put so nothing lands in the committed toml):
wrangler secret put GITHUB_OAUTH_CLIENT_ID       --config wrangler.github-oauth.toml
wrangler secret put GITHUB_OAUTH_REDIRECT_URI    --config wrangler.github-oauth.toml   # == the callback URL from step 1
wrangler secret put GITHUB_OAUTH_ALLOWED_ORIGINS --config wrangler.github-oauth.toml   # comma-separated exact origins
```

`GITHUB_OAUTH_ALLOWED_ORIGINS` is an exact-match list with no trailing slash, e.g. `https://<user>.github.io,http://localhost:8080`. `deploy` prints the Worker origin (`https://glint-github-oauth.<account>.workers.dev`) — that is `githubOAuthWorkerOrigin`.

**3. Wire the public values into `config.js`** (client ID, Worker origin, callback URL — never the secret):

```js
githubClientId: '<oauth app client id>',
githubOAuthWorkerOrigin: 'https://glint-github-oauth.<account>.workers.dev',
githubRedirectUri: 'https://<user>.github.io/glint/',   // == the callback URL
```

**4. Smoke test on the live site:** open a `#/gh/...` route → the in-app **Connect GitHub** dialog appears → **Authorize with GitHub** → approve → confirm list/read/edit/save. The dialog also offers a **fine-grained personal access token** field (Contents read/write on the repo) as the fallback; when no OAuth app is configured, only the token field is shown. An invalid token re-opens the dialog with an inline error rather than a browser alert.

Callback URL, `githubRedirectUri`, and `GITHUB_OAUTH_REDIRECT_URI` must all be byte-identical, or GitHub rejects the redirect. `GITHUB_OAUTH_ALLOWED_ORIGINS` must contain the exact origin the SPA is served from, or the Worker rejects the exchange with a CORS/origin error.

GitHub OAuth tokens and PATs stay in memory for the current page only; neither is stored in browser storage or URLs. The Drive access token is the exception: it is cached in `localStorage` (key `glint.drive.token.<clientId>`) until it expires (~1h) so reloads and route changes don't re-prompt. It is `drive.file`-scoped and short-lived, and the CSP — not token lifetime — is the control that prevents content exfiltration.

## Deploy (GitHub Pages)
`.github/workflows/pages.yml` builds on push to `main`, runs `npm run stage:spa`,
and publishes `dist-spa/` (`index.html`, `config.js`, `llms.txt`, and `assets/`).
Enable Pages → Source: **GitHub Actions** in repository settings.

After deploy, register the Pages origin as the Google **Authorized JS origin** (step 2 above) and
run one round-trip on the live site (auth → list → open → edit → save → persist).

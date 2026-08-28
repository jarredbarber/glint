# Glint SPA — setup & deploy

The SPA is a static site (`src/spa/`). It points at a backend via the URL hash and
becomes a wiki. No server, no Glint user database — access control is the backend's.

## Workspace URLs

| Backend | Hash route | Needs |
|---------|-----------|-------|
| Local dir | `#/local` | Chromium/Edge (File System Access API); no credentials |
| Google Drive | `#/drive/<folderId>` | `driveClientId` + `drivePickerKey` + numeric `driveAppId` (Picker authorizes the folder, #92) |
| GitHub repo | `#/gh/<owner>/<repo>` or `#/gh/<owner>/<repo>/tree/<ref>/<path>` | GitHub OAuth or an explicit fine-grained PAT |
| GitHub single file | `#/gh/<owner>/<repo>/blob/<ref>/<path>` | same GitHub token |
| Demo (in-memory) | `#/demo` | nothing |
| Single file (Drive/demo) | `#/s/drive/<fileId>` or `#/s/demo/<page>` | same as the underlying source |

GitHub routes follow github.com's own URL shape (#67): a `blob` segment means one file (read-only, no recursive listing; the path is repo-root relative), `tree` (or a bare `#/gh/<owner>/<repo>`) means a project folder. Omit the ref on a project route and Glint auto-detects the repo's default branch (`main`, `master`, … — #64); the legacy `#/gh/<owner>/<repo>/<path>@<ref>` form still opens as a project. Under `drive.file` (#92), opening a `#/drive/<folderId>` route probes the folder and, if it isn't authorized yet, opens the Google Picker so the user grants it (pick the linked folder or an ancestor); pasted, deep, and shared Drive links all funnel through this one route gate. Drive single files use `#/s/drive/<fileId>` and work only once their folder has been authorized (Drive reads any authorized file by id). The landing page's single link box accepts pasted `github.com/…/blob|tree/…` and `drive.google.com/file|folders/…` URLs, detects the source, and routes accordingly (#67); the **Open Google Drive** button opens the Picker in browse mode. The sidebar page-actions **copy-link** button generates the single-file URL for the current page.

## GitHub saving

Settings → **GitHub saving** picks how edits reach GitHub (a global setting; only affects `#/gh/…` projects, #60):

- **Direct** (default) — every save is one immediate commit (`Update <id> via Glint`).
- **Staged** — saves buffer in memory; a **Push** button in the sidebar footer shows the pending count and flushes them as a single commit on the working branch (prompts for the message). Edits live only in memory, so a tab close warns and discards them if you don't push.
- **Pull request** — same buffering, but Push commits to a fresh `glint/<timestamp>` branch and opens a PR against the working branch, returning its URL.

Only edits are staged; new pages, deletes, and pasted images still commit directly so an image exists before the page that references it.

The open page is reflected in the URL bar as a `/-/<path>` suffix on the project route (#69), e.g. `#/demo/-/Home.md` or `#/gh/o/r/tree/main/docs/-/intro.md`. This is the editable project view (distinct from the read-only `blob` single-file shares); reloading or copying it lands on that page.

## Image assets

Paste an image into the section editor to store it as a flat sidecar beside the page, named `<page-filename>.<shortid>.<ext>` (#30/#70). The Markdown reference is page-relative and backend-neutral, so it works on every backend and `glint-md render`/export inline it. Accepted: PNG, JPEG, GIF, WebP, up to 5,000,000 bytes; one image per paste. Uploads go through the active storage adapter (Drive multipart into the page's own folder, GitHub create-only commit, Local File System Access, in-memory for demo) and are create-only, never overwriting. The Markdown never stores a Drive ID, GitHub URL, `blob:`, or `data:` reference; standalone export inlines each asset as `data:` and aborts rather than emit a broken file.

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
  drivePickerKey: '...',   // public Google Picker API key (Drive folder access, #92)
  driveAppId: '123456789012', // numeric Google Cloud project number
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
4. Scope used: `drive.file` (non-restricted). It only exposes files Glint created or that the user hands
   over through the **Google Picker** — so opening `#/drive/<folderId>` first probes the folder, and if it
   isn't authorized yet, opens the Picker; picking the folder (or an ancestor) authorizes it and cascades to
   every descendant (#92, spike-proven). Already-authorized folders list with no prompt. The landing
   "Open Google Drive" button opens the Picker in browse mode. `drive.file` avoids the annual CASA security
   assessment that the full `drive` "restricted" scope requires for public release (the #83 tradeoff, reverted).
5. Enable the **Google Drive API** and the **Google Picker API** for the project.
6. Create a **Picker API key** (Credentials → API key), restrict it to the Picker API and your HTTP referrers,
   and set it as `drivePickerKey`. Set `driveAppId` to the project's numeric **project number** from IAM & Admin
   → Settings; Picker requires `setAppId(projectNumber)` with the `drive.file` scope. Both values are public.

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

GitHub OAuth tokens and PATs are cached in `localStorage` (key `glint.github.token`) until the user signs out or clears site data. The Drive access token is also cached in `localStorage` (key `glint.drive.token.v3.<clientId>`) until it expires (~1h) so reloads and route changes don't re-prompt. Author HTML is sanitized before trusted renderer transforms run. Complete custom HTML blocks execute only in `embed-host.html`, inside a sandbox without `allow-same-origin`; the parent CSP permits framing that fixed host but does not grant author content access to SPA credentials or storage.

## Deploy (GitHub Pages)
`.github/workflows/pages.yml` builds on push to `main`, runs `npm run stage:spa`,
and publishes `dist-spa/` (`index.html`, `embed-host.html`, `config.js`, `llm.txt`,
`privacy.html`, `terms.html`, and `assets/`).
Enable Pages → Source: **GitHub Actions** in repository settings.

After deploy, register the Pages origin as the Google **Authorized JS origin** (step 2 above) and
run one round-trip on the live site (auth → list → open → edit → save → persist).

### OAuth policy URLs

Google's OAuth verification asks for a privacy policy and terms of service URL.
Glint ships two static pages for this, served from the same Pages origin as the app:

- `https://<pages-domain>/privacy.html`
- `https://<pages-domain>/terms.html`

Enter these in the OAuth consent screen. Same-origin with the app satisfies Google's
policy-URL requirement. The pages are self-contained, with no external requests.

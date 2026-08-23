# Glint SPA — setup & deploy

The SPA is a static site (`src/spa/`). It points at a backend via the URL hash and
becomes a wiki. No server, no Glint user database — access control is the backend's.

## Workspace URLs

| Backend | Hash route | Needs |
|---------|-----------|-------|
| Local dir | `#/local` | Chromium/Edge (File System Access API); no credentials |
| Google Drive | `#/drive/<folderId>` | `driveClientId` |
| GitHub repo | `#/gh/<owner>/<repo>/<path>@<ref>` | GitHub OAuth or an explicit fine-grained PAT |
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

1. Create a GitHub OAuth App. Its callback URL must exactly equal `githubRedirectUri`; the app requests the broad `repo` scope.
2. Deploy the Worker with `wrangler deploy --config wrangler.github-oauth.toml`.
3. Configure `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, `GITHUB_OAUTH_REDIRECT_URI`, and `GITHUB_OAUTH_ALLOWED_ORIGINS` on the Worker. `GITHUB_OAUTH_ALLOWED_ORIGINS` is a comma-separated exact list such as `https://<user>.github.io,http://localhost:8080`.
4. Add the public client ID, Worker origin, and callback URL to `config.js`. Do not add the secret.
5. The sign-in screen explains that OAuth grants broad `repo` access. Choosing the explicit fallback prompts for a repository-selected fine-grained PAT with Contents read/write.

OAuth tokens and PATs stay in memory for the current page only; neither is stored in browser storage or URLs.

## Deploy (GitHub Pages)
`.github/workflows/pages.yml` builds on push to `main`, runs `npm run stage:spa`,
and publishes `dist-spa/` (`index.html`, `config.js`, `llms.txt`, and `assets/`).
Enable Pages → Source: **GitHub Actions** in repository settings.

After deploy, register the Pages origin as the Google **Authorized JS origin** (step 2 above) and
run one round-trip on the live site (auth → list → open → edit → save → persist).

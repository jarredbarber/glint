# GitHub and Drive OAuth worker decision

Issue: [#33](https://github.com/jarredbarber/glint/issues/33)

## Recommendation

Do **not** deploy a Cloudflare Worker now.

- **GitHub:** keep the existing fine-grained personal access token (PAT) flow, but stop persisting the PAT in `localStorage`; keep it in memory only. [#32](https://github.com/jarredbarber/glint/issues/32) makes credentials non-persistent, and its follow-up [#37](https://github.com/jarredbarber/glint/issues/37) owns removal of the current cached PAT.
- **Google Drive:** keep the existing Google Identity Services (GIS) browser token flow unchanged. It already uses Google's native SPA model and needs no worker.
- **Future trigger:** reconsider a GitHub-only Worker only after actual users show that creating and pasting a PAT is a material adoption problem. [#38](https://github.com/jarredbarber/glint/issues/38) records that contingent implementation and remains blocked by #33.

The Worker is technically feasible, but feasibility is not a reason to own another runtime. Today it would replace a working, repository-scoped credential with a broader OAuth grant, a device flow GitHub discourages for browser apps, and new deployment/availability work without demonstrated product need.

## Human decision

Approve one of these paths:

1. **Recommended:** no Worker; keep Drive browser-native; make GitHub PAT storage memory-only through #37; leave #38 unimplemented.
2. **Override:** explicitly accept the GitHub permission and device-flow risks and authorize the narrow Worker in #38.

## Current constraints

- Glint is a static GitHub Pages SPA with no account system, credential store, or application database.
- `src/spa/storage/github.ts` currently prompts for a fine-grained PAT, validates it with `api.github.com/user`, persists it in `localStorage`, and sends repository requests directly to `api.github.com`.
- GitHub's REST API supports browser CORS, so repository reads and writes need no proxy.
- GitHub's `github.com/login/*` OAuth endpoints do not provide the CORS behavior the SPA needs. Direct browser device flow is therefore not reliable even though device flow needs no client secret.
- `src/spa/storage/drive.ts` uses `google.accounts.oauth2.initTokenClient`, holds the Drive token in memory, and calls `www.googleapis.com` directly.
- The CSP already permits the direct GitHub and Google destinations. A Worker would require another `connect-src` origin.
- [#23](https://github.com/jarredbarber/glint/issues/23) already preserves edits across expired authentication, and [#34](https://github.com/jarredbarber/glint/issues/34) established the SPA egress/CSP policy. No other open issue duplicates #38's contingent Worker scope.

## GitHub feasibility, if the trigger is met

A Cloudflare Worker can bridge the CORS gap with two fixed operations:

| Operation | Request | Fixed GitHub upstream | Result |
| --- | --- | --- | --- |
| `POST /github/device/code` | `{}` | `POST /login/device/code` with configured `client_id` and scope | `device_code`, `user_code`, verification URI, expiry, polling interval |
| `POST /github/device/token` | `{ "device_code": "..." }` | `POST /login/oauth/access_token` with configured `client_id` and device grant type | pending/error fields or bearer token |

`OPTIONS` would exist only for those paths and exact allowed SPA origins. The Worker would add CORS headers; the SPA would continue calling `api.github.com` directly.

GitHub documents that device flow does not require a `client_secret`. It also requires clients to honor the returned polling interval, add five seconds after `slow_down`, stop on denial or expiry, and recognize that protocol errors may arrive in successful HTTP responses.

### Required invariants

- Fixed client ID, scope, grant type, GitHub hosts, paths, methods, and small JSON schemas; never accept a destination URL or caller-selected scope.
- Exact production origin allowlist, no wildcard, no credentials, `Vary: Origin`, and `Cache-Control: no-store`.
- One GitHub subrequest per accepted `POST`; no proxying of GitHub repository or Drive API traffic.
- No cookies, sessions, client secret, KV, database, refresh-token store, request/response body logging, or token caching.
- OAuth tokens remain in SPA memory and go only to `api.github.com`; discard any refresh token and reauthorize after expiry.
- Preserve GitHub's documented device errors. Convert upstream network/non-JSON failures to a stable `502` response without reflecting bodies or tokens.
- Treat CORS as a browser read control, not authentication. The OAuth client ID is public and non-browser callers can forge `Origin`.
- Start on Workers Free, fail closed, and do not enable paid billing without observed demand. Cloudflare currently documents 100,000 requests/day, 10 ms CPU, and 50 subrequests per invocation on Free. Add native rate limiting only after measured abuse; Cloudflare describes its binding as local and eventually consistent.

### Permission and flow tradeoffs

For private repository editing, a GitHub OAuth App needs `repo`, which GitHub documents as full access to public and private repositories plus related organization resources. That is broader than a fine-grained PAT limited to selected repositories and Contents read/write.

GitHub also says device flow is for headless/constrained clients and warns against enabling it without reason because it can be used to impersonate an app in phishing. A browser SPA has access to a browser, so this is an explicit exception to GitHub's preferred flow, not the default architecture.

These costs are acceptable only if PAT friction is observed to cost real users. Until then, the smaller and narrower system is the one already running.

## Google Drive decision

No Worker.

Google documents its GIS token model for browser apps: the browser receives a short-lived access token, calls Google APIs through REST/CORS, stores no per-user refresh token on a backend, and requests a new token from a user gesture after expiry. That exactly matches Glint's current Drive adapter.

A Drive worker would add a processor for bearer tokens and possibly file data without enabling background work, cross-session access, or any other current requirement. If Glint later needs server-side/offline Drive access, that would require Google's authorization-code model and secure refresh-token storage, not reuse of a GitHub CORS shim.

## Token handling now

The Drive token already stays in adapter memory. The GitHub PAT should match that behavior.

The settings design in #32 may persist source locations, theme, or editor preferences, but forbids OAuth tokens and PATs in browser persistence or URLs. Follow-up #37 removes the current `glint-gh-token` cache. Users re-enter the PAT after reload; that is the deliberate cost of the no-server design.

## Rejected alternatives

- **Worker now:** rejected because there is no demonstrated need and the permission/security/deployment costs exceed the current benefit.
- **Direct GitHub device flow:** rejected because the login endpoints do not provide usable browser CORS.
- **One Google/GitHub OAuth broker:** rejected because Drive already has a native browser seam.
- **Proxy all provider API traffic:** rejected because both data APIs already support browser CORS and Glint should not process file content server-side.
- **Arbitrary CORS proxy, token vault, refresh service, KV, Durable Objects, Turnstile, or custom identity:** rejected as unrelated infrastructure.

## Acceptance criteria for the recommended path

- #37 removes the GitHub PAT from `localStorage`; Drive and GitHub credentials exist only in memory, consistent with #32.
- GitHub PAT validation and direct `api.github.com` list/read/write behavior remain intact, including the repository-scoped fine-grained PAT guidance.
- Drive continues to use GIS and direct Google API CORS with no Worker request.
- Documentation consistently describes the memory-only PAT and Drive client ID; stale `githubClientId` configuration text is removed.
- #38 is not implemented unless a human explicitly overrides this recommendation after accepting the broad `repo` scope, device-flow warning, and Cloudflare ownership.

## Official sources

- GitHub, [Authorizing OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps): CORS preflight limitation, device-flow inputs, no client secret, polling, expiry, limits, and errors.
- GitHub, [Best practices for creating an OAuth app](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/best-practices-for-creating-an-oauth-app): public-client token handling, minimal scopes, and the warning against device flow without a constrained-client need.
- GitHub, [Scopes for OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps): breadth of `repo` and `public_repo`.
- GitHub, [REST API CORS](https://docs.github.com/en/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests): direct browser support on `api.github.com`.
- Google, [Use the token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model): browser tokens, REST/CORS, no backend refresh-token store, and expiry handling.
- Cloudflare, [CORS header proxy](https://developers.cloudflare.com/workers/examples/cors-header-proxy/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [pricing](https://developers.cloudflare.com/workers/platform/pricing/), and [Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/): feasibility, platform limits, cost boundary, and optional abuse control.

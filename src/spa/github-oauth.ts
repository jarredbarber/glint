export type GitHubOAuthConfig = { clientId: string; workerOrigin: string; redirectUri: string };

const STATE_KEY = 'glint-gh-oauth-state';
// GitHub redirects back to the fragment-less redirect_uri, dropping the #/gh/... route.
// Stash it before leaving so the callback can restore it after the token exchange (#37).
const RETURN_KEY = 'glint-gh-oauth-return';

export function takeGitHubOAuthReturn(): string | null {
    const hash = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    return hash || null;
}

function callbackUrl(): URL {
    return new URL(location.href);
}

function cleanCallbackUrl(url: URL): void {
    url.search = '';
    history.replaceState(null, '', url);
}

export function beginGitHubOAuth(config: GitHubOAuthConfig): void {
    const state = crypto.randomUUID();
    sessionStorage.setItem(STATE_KEY, state);
    sessionStorage.setItem(RETURN_KEY, location.hash);
    const authorize = new URL('https://github.com/login/oauth/authorize');
    authorize.search = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        scope: 'repo',
        state,
    }).toString();
    // No throw after assign: the throw raced the navigation and surfaced as a bogus
    // "redirect did not start" error. The caller hangs on a never-resolving promise
    // until the browser unloads this page (#37).
    location.assign(authorize.toString());
}

export async function takeGitHubOAuthCallback(config: GitHubOAuthConfig): Promise<string | null> {
    const url = callbackUrl();
    const code = url.searchParams.get('code');
    const returnedState = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    if (!code && !error) return null;
    const expectedState = sessionStorage.getItem(STATE_KEY);
    sessionStorage.removeItem(STATE_KEY);
    cleanCallbackUrl(url);
    if (error) throw new Error(error === 'access_denied' ? 'GitHub sign-in was cancelled. You can retry or use a personal access token.' : 'GitHub sign-in failed. You can retry or use a personal access token.');
    if (!expectedState || !returnedState || expectedState !== returnedState) throw new Error('GitHub sign-in state did not match. Retry sign-in.');
    const response = await fetch(`${config.workerOrigin.replace(/\/$/, '')}/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, state: returnedState }),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok || !body || typeof body !== 'object' || typeof (body as { access_token?: unknown }).access_token !== 'string') {
        const message = body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string' ? (body as { error: string }).error : 'GitHub token exchange failed. Retry or use a personal access token.';
        throw new Error(message);
    }
    return (body as { access_token: string }).access_token;
}

// Public OAuth configuration. Client secrets belong only in the OAuth Worker.
window.GLINT_CONFIG = {
    driveClientId: 'xxxxx.apps.googleusercontent.com',
    drivePickerKey: 'AIza...',   // public Google Picker API key, referrer-restricted (#92)
    driveAppId: '123456789012', // numeric Google Cloud project number
    githubClientId: 'github-oauth-app-client-id',
    githubOAuthWorkerOrigin: 'https://glint-github-oauth.example.workers.dev',
    githubRedirectUri: 'https://example.github.io/glint/',
};

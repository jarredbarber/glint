// Public OAuth configuration. Client IDs and Worker origins are public; secrets never appear here.
window.GLINT_CONFIG = {
    driveClientId: '833335009551-iar5dhp95n4o753f41snc05ls89i28er.apps.googleusercontent.com',
    // Public Google Picker API key (restricted to the Picker API + these HTTP referrers).
    drivePickerKey: 'AIzaSyBWFgEtZJjwJS8-7qMSjOmBYnsXIyiOfa4',
    driveAppId: '833335009551', // Google Cloud project number required by Picker with drive.file
    githubClientId: 'Ov23liHgd7cWeAo4KjRZ',
    githubOAuthWorkerOrigin: 'https://glint-github-oauth.hector-ea.workers.dev',
    githubRedirectUri: 'https://jarredbarber.github.io/glint/',
};

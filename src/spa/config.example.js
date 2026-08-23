// Copy to config.js and fill in your public OAuth client IDs.
// These are PUBLIC identifiers (safe to commit / serve) — not secrets.
// The Drive and GitHub backends read them; fake/local need nothing here.
window.GLINT_CONFIG = {
    driveClientId: 'xxxxx.apps.googleusercontent.com',   // Google OAuth client (Web app), authorized JS origin = your Pages URL
    githubClientId: 'Iv1.xxxxxxxxxxxxxxxx',              // GitHub OAuth App with device flow enabled
};

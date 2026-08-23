// Copy to config.js and fill in your public Drive OAuth client ID.
// This is a PUBLIC identifier (safe to commit / serve) — not a secret.
// Only the Drive backend reads it; fake/local/github need nothing here
// (GitHub uses a pasted fine-grained PAT, cached in localStorage).
window.GLINT_CONFIG = {
    driveClientId: 'xxxxx.apps.googleusercontent.com',   // Google OAuth client (Web app), authorized JS origin = your Pages URL
};

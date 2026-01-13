import { GlintConfig } from '../config.js';
import { renderHead } from './head.js';

export const renderLoginPage = (config: GlintConfig, redirect: string = '/', error?: string) => `
<!DOCTYPE html>
<html lang="en">
    ${renderHead('Login', config.theme)}
    <body class="${config.theme}">
        <div class="login-container">
            <div class="login-card">
                <img src="/assets/logo.png" alt="glint" class="login-logo">
                <h1>Login Required</h1>
                ${error ? `<div class="login-error">${escapeHtml(error)}</div>` : ''}
                <form method="POST" action="/api/auth/login" class="login-form">
                    <input type="hidden" name="redirect" value="${escapeHtml(redirect)}">
                    <div class="form-group">
                        <label for="password">Password</label>
                        <input
                            type="password"
                            id="password"
                            name="password"
                            required
                            autofocus
                            autocomplete="current-password"
                        >
                    </div>
                    <button type="submit" class="login-button">Login</button>
                </form>
            </div>
        </div>
        <style>
        /* Override body flex layout for login page */
        body {
            display: block!important;
            overflow: auto!important;
            height: auto!important;
        }
        .login-container {
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 1rem;
        }
        .login-card {
            background: var(--sidebar-bg, #2d353b);
            border-radius: 12px;
            padding: 2rem;
            width: 100%;
            max-width: 400px;
            text-align: center;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        }
        .login-logo {
            width: 120px;
            margin-bottom: 1.5rem;
        }
        .login-card h1 {
            margin: 0 0 1.5rem 0;
            font-size: 1.5rem;
            color: var(--text-primary, #d3c6aa);
        }
        .login-error {
            background: rgba(255, 100, 100, 0.2);
            color: #ff6b6b;
            padding: 0.75rem;
            border-radius: 6px;
            margin-bottom: 1rem;
            font-size: 0.9rem;
        }
        .login-form {
            text-align: left;
        }
        .form-group {
            margin-bottom: 1.25rem;
        }
        .form-group label {
            display: block;
            margin-bottom: 0.5rem;
            font-size: 0.9rem;
            color: var(--text-secondary, #9da9a0);
        }
        .form-group input {
            width: 100%;
            padding: 0.75rem;
            border: 1px solid var(--border-color, #3d484d);
            border-radius: 6px;
            background: var(--bg-primary, #232a2e);
            color: var(--text-primary, #d3c6aa);
            font-size: 1rem;
            box-sizing: border-box;
        }
        .form-group input:focus {
            outline: none;
            border-color: var(--accent-color, #a7c080);
        }
        .login-button {
            width: 100%;
            padding: 0.75rem;
            border: none;
            border-radius: 6px;
            background: var(--accent-color, #a7c080);
            color: var(--bg-primary, #232a2e);
            font-size: 1rem;
            font-weight: 500;
            cursor: pointer;
            transition: opacity 0.2s;
        }
        .login-button:hover {
            opacity: 0.9;
        }
        </style>
    </body>
</html>
`;

export function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

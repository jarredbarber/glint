import path from 'node:path';
import { GlintConfig } from './config.js';
import { FileNode, renderFileTree } from './filetree.js';
import { HeadingNode } from './rehype-extract-headings.js';

export const renderHead = (title: string, theme: string) => `
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Outfit:wght@500;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/assets/katex/katex.min.css">
    <link rel="stylesheet" href="/assets/themes/${theme}.css" id="theme-stylesheet">
    <link rel="stylesheet" href="/assets/layout.css">
    <link rel="stylesheet" href="/assets/highlight.css">
    <script>
        // Apply user's preferred theme from localStorage (before first paint)
        (function() {
            var saved = localStorage.getItem('glint-theme');
            if (saved) {
                var link = document.getElementById('theme-stylesheet');
                if (link) link.href = '/assets/themes/' + saved + '.css';
            }
        })();
    </script>
    <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
</head>
`;

export interface SidebarOptions {
    fileTree: FileNode[];
    currentPath: string;
    headings?: HeadingNode[];
    currentTheme?: string;
    authEnabled?: boolean;
    authenticated?: boolean;
}

export const renderSidebar = (options: SidebarOptions) => {
    const { fileTree, currentPath, headings = [], currentTheme = 'nord', authEnabled = false, authenticated = false } = options;
    const themes = ['default', 'everforest-dark', 'nord', 'gruvbox-dark', 'catppuccin-mocha', 'solarized-light'];

    const logoutButton = authEnabled && authenticated ? `
        <button class="logout-button" onclick="
            fetch('/api/auth/logout', { method: 'POST' })
                .then(() => window.location.reload());
        ">Logout</button>
    ` : '';

    return `
<aside class="sidebar">
    <div class="sidebar-scrollable">
        <div class="sidebar-branding">
            <a href="/">
                <img src="/assets/logo.png" alt="glint" class="sidebar-logo">
            </a>
        </div>
        <details open class="sidebar-section">
            <summary class="sidebar-header">Files</summary>
            <nav class="file-tree">
                <ul>${renderFileTree(fileTree, currentPath)}</ul>
            </nav>
        </details>

        ${headings.length > 0 ? `
        <details open class="sidebar-section" style="margin-top: 1rem;">
            <summary class="sidebar-header">Outline</summary>
            <nav class="outline-tree">
                <ul>
                    ${headings.map(h => `
                        <li class="depth-${h.depth}">
                            <a href="#${h.id}">${h.text}</a>
                        </li>
                    `).join('')}
                </ul>
            </nav>
        </details>
        ` : ''}
    </div>
    <footer class="sidebar-footer">
        <select class="theme-select" onchange="
            const theme = this.value;
            localStorage.setItem('glint-theme', theme);
            const themeLink = document.querySelector('link[href*=\\'themes/\\']');
            if (themeLink) themeLink.href = '/assets/themes/' + theme + '.css';
            fetch('/api/theme', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme }) });
        ">
            ${themes.map(t => `<option value="${t}" ${t === currentTheme ? 'selected' : ''}>${t.replace('-', ' ')}</option>`).join('')}
        </select>
        <label class="vim-toggle">
            <input type="checkbox" id="vim-mode-toggle" onchange="
                localStorage.setItem('glint-vim-mode', this.checked);
            ">
            <span>Vim mode</span>
        </label>
        <script>
            (function() {
                var stored = localStorage.getItem('glint-vim-mode');
                var enabled = stored === null ? true : stored === 'true';
                document.getElementById('vim-mode-toggle').checked = enabled;
            })();
        </script>
        ${logoutButton}
    </footer>
</aside>
`;
};

export const renderScripts = () => `
<script>
    document.addEventListener('DOMContentLoaded', function() {
        if (typeof mermaid !== 'undefined') {
            mermaid.initialize({
                startOnLoad: true,
                theme: 'dark',
                securityLevel: 'loose',
                themeVariables: {
                    fontFamily: '"Inter", sans-serif',
                    primaryColor: '#a7c080',
                    primaryTextColor: '#2d353b',
                    primaryBorderColor: '#a7c080',
                    lineColor: '#d3c6aa',
                    secondaryColor: '#dbbc7f',
                    tertiaryColor: '#e67e80'
                }
            });
        }
    });

    // Hot Reloading
    const evtSource = new EventSource("/events");
    let isUnloading = false;

    window.addEventListener('beforeunload', () => {
        isUnloading = true;
        evtSource.close();
    });

    evtSource.onmessage = (event) => {
        if (event.data === "reload") {
            // Check if inline editor is active
            if (window.__glintEditingActive) {
                console.log("SSE reload suppressed (inline editor active)");
                window.__glintPendingReload = true;
                return;
            }
            // Check if a client-side refresh just happened (suppress SSE reload)
            const suppressTime = sessionStorage.getItem('glint-suppress-reload');
            if (suppressTime && Date.now() - parseInt(suppressTime) < 3000) {
                console.log("SSE reload suppressed (client-side refresh in progress)");
                sessionStorage.removeItem('glint-suppress-reload');
                return;
            }
            console.log("Config changed, reloading...");
            // Save scroll position before reload
            const contentEl = document.querySelector('.content') || document.querySelector('main');
            if (contentEl) {
                sessionStorage.setItem('glint-scroll-y', String(contentEl.scrollTop));
            }
            window.location.reload();
        }
    };
    evtSource.onerror = () => {
        // SSE connection errors are normal during navigation, don't reload
        console.debug('SSE connection error');
    };
</script>
<script src="/assets/router.bundle.js"></script>
<script src="/assets/upload.bundle.js"></script>
<script src="/assets/editor.bundle.js"></script>
<script src="/assets/editor-integration.bundle.js"></script>
<script src="/assets/image-resize.bundle.js"></script>
`;

export const formatDate = (rawDate: unknown): string | null => {
    if (!rawDate) return null;
    if (rawDate instanceof Date) {
        return rawDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    } else if (typeof rawDate === 'string') {
        const parsed = new Date(rawDate);
        return isNaN(parsed.getTime()) ? rawDate : parsed.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    }
    return String(rawDate);
};

export const renderMetadata = (frontmatter: Record<string, unknown>) => {
    const date = formatDate(frontmatter.date);
    const updated = formatDate(frontmatter.updated || frontmatter.modified);
    const author = frontmatter.author as string | undefined;
    const category = frontmatter.category as string | undefined;
    const tags = frontmatter.tags as string[] | string | undefined;
    const description = (frontmatter.description || frontmatter.summary) as string | undefined;
    const readingTime = frontmatter['reading-time'] as string | undefined;
    const image = (frontmatter.image || frontmatter.thumbnail) as string | undefined;
    const isDraft = frontmatter.draft === true;

    const hasAnyMeta = date || author || updated || category || tags || description || readingTime || isDraft;
    if (!hasAnyMeta && !image) return '';

    let html = '';

    // Featured image
    if (image) {
        html += `<img class="featured-image" src="${image}" alt="Featured image">`;
    }

    // Draft indicator
    if (isDraft) {
        html += `<div class="draft-badge">📝 Draft</div>`;
    }

    // Primary meta line (date, author, category, reading time)
    const metaParts = [];
    if (date) metaParts.push(`<span class="meta-date">${date}</span>`);
    if (updated && updated !== date) metaParts.push(`<span class="meta-updated">Updated ${updated}</span>`);
    if (author) metaParts.push(`<span class="meta-author">by ${author}</span>`);
    if (category) metaParts.push(`<span class="meta-category">${category}</span>`);
    if (readingTime) metaParts.push(`<span class="meta-reading-time">📖 ${readingTime}</span>`);

    if (metaParts.length > 0) {
        html += `<div class="article-meta">${metaParts.join(' · ')}</div>`;
    }

    // Tags as pills
    if (tags) {
        const tagList = Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim());
        const tagHtml = tagList.map(t => `<span class="tag">${t}</span>`).join('');
        html += `<div class="article-tags">${tagHtml}</div>`;
    }

    // Description/summary
    if (description) {
        html += `<p class="article-description">${description}</p>`;
    }

    return html;
};

export interface RenderOptions {
    content: string;
    title: string;
    config: GlintConfig;
    fileTree: FileNode[];
    currentPath: string;
    headings?: HeadingNode[];
    frontmatter?: Record<string, unknown>;
    authEnabled?: boolean;
    authenticated?: boolean;
}

export const renderHtml = (options: RenderOptions) => {
    const { content, title, config, fileTree, currentPath, headings = [], frontmatter = {}, authEnabled = false, authenticated = false } = options;
    return `
<!DOCTYPE html>
<html lang="en">
${renderHead(title, config.theme)}
<body class="${config.theme}">
    ${renderSidebar({ fileTree, currentPath, headings, currentTheme: config.theme, authEnabled, authenticated })}
    <main class="content">
        <div class="content-wrapper">
            <header class="article-header">
                <h1>${title}</h1>
                ${renderMetadata(frontmatter)}
                <div class="title-accent"></div>
            </header>
            ${content}
        </div>
    </main>
    ${renderScripts()}
</body>
</html>
`;
};

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
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
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

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

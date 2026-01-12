import path from 'node:path';
import { GlintConfig } from './config.js';
import { FileNode, renderFileTree } from './filetree.js';
import { HeadingNode } from './rehype-extract-headings.js';

export const renderHead = (title: string, theme: string, styles: string[] = []) => `
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
    ${styles.map(s => `<link rel="stylesheet" href="${s}">`).join('\n')}
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
    isShared?: boolean;
}

export const renderSidebar = (options: SidebarOptions) => {
    const { fileTree, currentPath, headings = [], currentTheme = 'nord', authEnabled = false, authenticated = false, isShared = false } = options;
    const themes = ['default', 'everforest-dark', 'nord', 'gruvbox-dark', 'catppuccin-mocha', 'solarized-light'];

    const logoutButton = authEnabled && authenticated ? `
        <button class="logout-button" onclick="
            fetch('/api/auth/logout', { method: 'POST' })
                .then(() => window.location.reload());
        ">Logout</button>
    ` : '';

    // Views section (Task View)
    const viewsSection = !isShared ? `
        <details open class="sidebar-section">
            <summary class="sidebar-header">Views</summary>
            <nav class="views-list">
                <ul>
                    <li class="${currentPath === '/tasks' ? 'active' : ''}">
                        <a href="/tasks" data-router="false">
                            <span class="view-icon">✅</span> Task View
                        </a>
                    </li>
                </ul>
            </nav>
        </details>
    ` : '';

    // If it's a shared view, we only show the branding and the outline, not the full file tree
    const filesSection = !isShared ? `
        <details open class="sidebar-section">
            <summary class="sidebar-header">Files</summary>
            <nav class="file-tree">
                <ul>${renderFileTree(fileTree, currentPath)}</ul>
            </nav>
        </details>
    ` : '';

    return `
<aside class="sidebar ${isShared ? 'shared-view' : ''}">
    <div class="sidebar-scrollable">
        <div class="sidebar-branding">
            <a href="/">
                <img src="/assets/logo.png" alt="glint" class="sidebar-logo">
            </a>
        </div>
        
        ${viewsSection}
        ${filesSection}
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
        ${!isShared ? `
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
        ` : ''}
        ${!isShared && authenticated ? `
        <button class="share-sidebar-button" onclick="window.openShareModal()">
            <span class="share-icon">🔗</span> Share
        </button>
        ` : ''}
        ${logoutButton}
    </footer>
</aside>
`;
};

export const renderScripts = (shareId?: string, extraScripts: string[] = []) => `
<script>
    // Global share context
    window.__glintShareId = ${shareId ? `'${shareId}'` : 'null'};
    document.addEventListener('DOMContentLoaded', function() {
        if (typeof mermaid !== 'undefined') {
            // Get theme from localStorage or body class
            var savedTheme = localStorage.getItem('glint-theme');
            var bodyClass = document.body.className;
            var theme = savedTheme || bodyClass || 'nord';

            // Theme configurations for Mermaid
            var themeConfigs = {
                'default': { base: 'default', primary: '#4a90d9', secondary: '#45b7d1', tertiary: '#96ceb4', text: '#333', bg: '#fff' },
                'everforest-dark': { base: 'dark', primary: '#a7c080', secondary: '#dbbc7f', tertiary: '#e67e80', text: '#d3c6aa', bg: '#2d353b' },
                'nord': { base: 'dark', primary: '#88c0d0', secondary: '#81a1c1', tertiary: '#b48ead', text: '#eceff4', bg: '#2e3440' },
                'gruvbox-dark': { base: 'dark', primary: '#b8bb26', secondary: '#fabd2f', tertiary: '#fb4934', text: '#ebdbb2', bg: '#282828' },
                'catppuccin-mocha': { base: 'dark', primary: '#89b4fa', secondary: '#f5c2e7', tertiary: '#f38ba8', text: '#cdd6f4', bg: '#1e1e2e' },
                'solarized-light': { base: 'default', primary: '#268bd2', secondary: '#2aa198', tertiary: '#d33682', text: '#657b83', bg: '#fdf6e3' }
            };

            var config = themeConfigs[theme] || themeConfigs['nord'];

            mermaid.initialize({
                startOnLoad: true,
                theme: config.base,
                securityLevel: 'loose',
                themeVariables: {
                    fontFamily: '"Inter", sans-serif',
                    primaryColor: config.primary,
                    primaryTextColor: config.bg,
                    primaryBorderColor: config.primary,
                    lineColor: config.text,
                    secondaryColor: config.secondary,
                    tertiaryColor: config.tertiary,
                    background: config.bg,
                    mainBkg: config.bg,
                    textColor: config.text
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
<script src="/assets/outline.bundle.js"></script>
<script src="/assets/image-resize.bundle.js"></script>
<script src="/assets/drag-reorder.bundle.js"></script>
<script src="/assets/share.bundle.js"></script>
<script src="/assets/citations.bundle.js"></script>
${extraScripts.map(s => `<script src="${s}"></script>`).join('\n')}
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

/**
 * Renders the right-margin outline for wide viewports
 */
export const renderRightOutline = (headings: HeadingNode[]) => {
    if (headings.length === 0) return '';

    const buildHierarchy = (headings: HeadingNode[]) => {
        const result: string[] = [];
        let i = 0;

        while (i < headings.length) {
            const heading = headings[i];
            const nextHeading = headings[i + 1];

            if (nextHeading && nextHeading.depth > heading.depth) {
                const children: HeadingNode[] = [];
                let j = i + 1;

                while (j < headings.length && headings[j].depth > heading.depth) {
                    children.push(headings[j]);
                    j++;
                }

                result.push(`
                    <li class="right-outline-item" data-depth="${heading.depth}">
                        <div class="right-outline-section" data-section-id="${heading.id}">
                            <div class="right-outline-section-header">
                                <span class="outline-toggle" data-section-id="${heading.id}" aria-label="Toggle section"></span>
                                <a href="#${heading.id}" class="right-outline-link">${heading.text}</a>
                            </div>
                            <ul class="right-outline-section-children">
                                ${buildHierarchy(children)}
                            </ul>
                        </div>
                    </li>
                `);

                i = j;
            } else {
                result.push(`
                    <li class="right-outline-item" data-depth="${heading.depth}">
                        <a href="#${heading.id}" class="right-outline-link">${heading.text}</a>
                    </li>
                `);
                i++;
            }
        }

        return result.join('');
    };

    return `
        <aside class="right-outline" aria-label="Table of contents">
            <div class="right-outline-header">On This Page</div>
            <ul class="right-outline-list">
                ${buildHierarchy(headings)}
            </ul>
        </aside>
    `;
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
    access?: string;
    shareId?: string;
    scripts?: string[];
    styles?: string[];
}


export const renderHtml = (options: RenderOptions) => {
    const { content, title, config, fileTree, currentPath, headings = [], frontmatter = {}, authEnabled = false, authenticated = false, access, shareId, scripts = [], styles = [] } = options;
    const isShared = !!shareId;

    return `
<!DOCTYPE html>
<html lang="en">
${renderHead(title, config.theme, styles)}
<body class="${config.theme} ${isShared ? 'shared-view' : ''}" data-access="${access || (authenticated ? 'edit' : 'view')}">
    <div class="mobile-toggle" onclick="document.body.classList.toggle('sidebar-open')">☰</div>
    <div class="mobile-overlay" onclick="document.body.classList.remove('sidebar-open')"></div>
    ${renderSidebar({ fileTree, currentPath, headings, currentTheme: config.theme, authEnabled, authenticated, isShared })}
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
    ${!isShared ? renderRightOutline(headings) : ''}
    ${!isShared ? `
    <div class="modal-overlay" id="share-modal-overlay" onclick="if(event.target === this) window.closeShareModal()">
        <div class="share-modal">
            <div class="share-modal-header">
                <h2>Share Page</h2>
                <button class="close-modal" onclick="window.closeShareModal()">&times;</button>
            </div>
            <div class="share-modal-content">
                <div class="share-form">
                    <div class="form-row">
                        <div class="form-group-share">
                            <label>Permission</label>
                            <select id="share-access">
                                <option value="view">View Only</option>
                                <option value="comment">Allow Comments</option>
                                <option value="edit">Allow Editing</option>
                            </select>
                        </div>
                        <div class="form-group-share">
                            <label>Expires</label>
                            <select id="share-expiry">
                                <option value="0">Never</option>
                                <option value="3600">1 Hour</option>
                                <option value="86400">1 Day</option>
                                <option value="604800">1 Week</option>
                            </select>
                        </div>
                    </div>
                    <div class="form-group-share">
                        <label>Label (optional)</label>
                        <input type="text" id="share-label" placeholder="e.g. For client review">
                    </div>
                    <button class="create-share-btn" onclick="window.createShare()">Create Shareable Link</button>
                </div>

                <div class="existing-shares">
                    <h3>Active Share Links</h3>
                    <div class="share-list" id="share-list">
                        <!-- Populated by JS -->
                        <div class="loading-shares">Loading...</div>
                    </div>
                </div>
            </div>
        </div>
    </div>
    <script>
        // Close mobile sidebar on navigation
        document.addEventListener('click', (e) => {
            if (e.target.tagName === 'A' && document.body.classList.contains('sidebar-open')) {
                document.body.classList.remove('sidebar-open');
            }
        });
    </script>
    ` : ''}
    ${renderScripts(shareId, scripts)}
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
        /* Override body flex layout for login page */
        body {
            display: block !important;
            overflow: auto !important;
            height: auto !important;
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

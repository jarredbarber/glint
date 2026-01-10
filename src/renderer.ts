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
    <link rel="stylesheet" href="/assets/themes/${theme}.css">
    <link rel="stylesheet" href="/assets/layout.css">
    <link rel="stylesheet" href="/assets/highlight.css">
    <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
</head>
`;

export const renderSidebar = (fileTree: FileNode[], currentPath: string, headings: HeadingNode[] = [], currentTheme: string = 'everforest-dark') => {
    const themes = ['default', 'everforest-dark', 'nord', 'gruvbox-dark', 'catppuccin-mocha', 'solarized-light'];

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
        <select class="theme-select" onchange="fetch('/api/theme', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme: this.value }) })">
            ${themes.map(t => `<option value="${t}" ${t === currentTheme ? 'selected' : ''}>${t.replace('-', ' ')}</option>`).join('')}
        </select>
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
            // Check if a client-side refresh just happened (suppress SSE reload)
            const suppressTime = sessionStorage.getItem('glint-suppress-reload');
            if (suppressTime && Date.now() - parseInt(suppressTime) < 3000) {
                console.log("SSE reload suppressed (client-side refresh in progress)");
                sessionStorage.removeItem('glint-suppress-reload');
                return;
            }
            console.log("Config changed, reloading...");
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

export const renderHtml = (content: string, title: string, config: GlintConfig, fileTree: FileNode[], currentPath: string, headings: HeadingNode[] = [], frontmatter: Record<string, unknown> = {}) => `
<!DOCTYPE html>
<html lang="en">
${renderHead(title, config.theme)}
<body class="${config.theme}">
    ${renderSidebar(fileTree, currentPath, headings, config.theme)}
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

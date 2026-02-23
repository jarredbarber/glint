import { FileNode, renderFileTree } from '../filetree.js';
import { HeadingNode } from '../rehype-extract-headings.js';
import { AVAILABLE_THEMES } from '../config.js';

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
                    <li class="${currentPath === '/d/tasks' ? 'active' : ''}">
                        <a href="/d/tasks" data-router="false">
                            <span class="view-icon">✅</span> Task View
                        </a>
                    </li>
                    <li class="${currentPath === '/d/journal' ? 'active' : ''}">
                        <a href="/d/journal" data-router="false">
                            <span class="view-icon">📅</span> Journal View
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
    <button class="sidebar-collapse-toggle" onclick="
        const sb = this.closest('.sidebar');
        sb.classList.toggle('collapsed');
        localStorage.setItem('glint-sidebar-collapsed', sb.classList.contains('collapsed'));
    "></button>
    <script>
        (function() {
            if (localStorage.getItem('glint-sidebar-collapsed') === 'true') {
                document.querySelector('.sidebar').classList.add('collapsed');
            }
        })();
    </script>
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
            document.body.className = document.body.className.replace(/\\S+/, theme);
            const themeLink = document.querySelector('link[href*=\\'themes/\\']');
            if (themeLink) themeLink.href = '/assets/themes/' + theme + '.css';
            fetch('/api/theme', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme }) });
        ">
            ${AVAILABLE_THEMES.map(t => `<option value="${t}" ${t === currentTheme ? 'selected' : ''}>${t.replace('-', ' ')}</option>`).join('')}
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

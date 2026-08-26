import { FileNode, renderFileTree } from '../filetree.js';
import { HeadingNode } from '../rehype-extract-headings.js';
import { AVAILABLE_COLOR_SCHEMES } from '../config.js';

export interface SidebarOptions {
    fileTree: FileNode[];
    currentPath: string;
    headings?: HeadingNode[];
    currentColorScheme?: string;
    isShared?: boolean;
    static?: boolean;
    /** Static share page: suppress the branding home link. Chrome hiding is carried via isShared. */
    standalone?: boolean;
}

export const renderSidebar = (options: SidebarOptions) => {
    const { fileTree, currentPath, headings = [], currentColorScheme = 'nord', isShared = false, standalone = false } = options;
    const minimalChrome = options.isShared || options.static;

    // Views section (Task View) — dynamic server routes, omitted from static/shared
    const viewsSection = !minimalChrome ? `
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
        ${standalone
            ? '' // Standalone share pages carry no branding — no logo, no mention of glint.
            : `<div class="sidebar-branding">
            <a href="/"><img src="/assets/logo.png" alt="glint" class="sidebar-logo"></a>
        </div>`}

        ${viewsSection}
        ${filesSection}
    </div>
    <footer class="sidebar-footer">
        <select class="color-scheme-select" onchange="
            const colorScheme = this.value;
            document.body.className = document.body.className.replace(/\\S+/, colorScheme);
            const colorSchemeLink = document.querySelector('link[href*=\\'color-schemes/\\']');
            if (colorSchemeLink) colorSchemeLink.href = colorSchemeLink.href.replace(/[^/]*\\.css$/, colorScheme + '.css');
            ${!minimalChrome ? `fetch('/api/color-scheme', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ colorScheme }) });` : ''}
        ">
            ${AVAILABLE_COLOR_SCHEMES.map(t => `<option value="${t}" ${t === currentColorScheme ? 'selected' : ''}>${t.replace('-', ' ')}</option>`).join('')}
        </select>
        ${!minimalChrome ? `
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
    </footer>
</aside>
`;
};

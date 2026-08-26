import { GlintConfig } from './config.js';
import { FileNode } from './filetree.js';
import { HeadingNode } from './rehype-extract-headings.js';
import { escapeHtml } from './utils/html.js';

import { renderHead } from './renderer/head.js';
import { renderSidebar } from './renderer/sidebar.js';
import { renderScripts } from './renderer/scripts.js';
import { renderMetadata } from './renderer/metadata.js';
import { renderRightOutline } from './renderer/outline.js';
import { renderBreadcrumbs } from './renderer/breadcrumbs.js';

export interface RenderOptions {
    content: string;
    title: string;
    config: GlintConfig;
    fileTree: FileNode[];
    currentPath: string;
    headings?: HeadingNode[];
    frontmatter?: Record<string, unknown>;
    access?: string;
    scripts?: string[];
    styles?: string[];
    static?: boolean;
    standalone?: boolean;
}

export const renderHtml = (options: RenderOptions) => {
    const { content, title, config, fileTree, currentPath, headings = [], frontmatter = {}, access, scripts = [], styles = [], static: isStatic = false, standalone = false } = options;
    const isShared = standalone;

    return `
<!DOCTYPE html>
<html lang="en">
    ${renderHead(title, config.colorScheme, styles)}
    <body class="${config.colorScheme} ${isShared ? 'shared-view' : ''}" data-access="${isStatic ? 'view' : (access || 'edit')}" data-path="${escapeHtml(currentPath)}">
        <div class="mobile-toggle">☰</div>
        <div class="mobile-overlay"></div>
        <div id="command-palette-overlay" class="command-palette-overlay" style="display: none;">
        <div class="command-palette-modal">
            <div class="command-palette-search">
                <span class="search-icon">🔍</span>
                <input type="text" id="command-input" placeholder="Search commands..." autocomplete="off">
            </div>
            <div class="command-palette-results" id="command-results"></div>
            <div class="command-palette-footer">
                <span><kbd>↑↓</kbd> to navigate</span>
                <span><kbd>↵</kbd> to select</span>
                <span><kbd>esc</kbd> to close</span>
            </div>
        </div>
    </div>
    <div id="shortcuts-help-overlay" class="command-palette-overlay" style="display: none;" onclick="if(event.target === this) this.style.display = 'none'">
        <div class="command-palette-modal">
            <div class="command-palette-header" style="padding: 1rem; border-bottom: 1px solid var(--border-color); font-weight: 700;">
                Keyboard Shortcuts
            </div>
            <div class="command-palette-results" style="padding: 0.5rem 0;">
                <div class="command-item">
                    <div class="command-content">
                        <div class="command-title"><kbd>?</kbd> Show help</div>
                    </div>
                </div>
                <div class="command-item">
                    <div class="command-content">
                        <div class="command-title"><kbd>Cmd+K</kbd> Command Palette</div>
                    </div>
                </div>
                <div class="command-item">
                    <div class="command-content">
                        <div class="command-title"><kbd>e</kbd> Edit hovered section</div>
                    </div>
                </div>
                <div class="command-item">
                    <div class="command-content">
                        <div class="command-title"><kbd>c</kbd> Comment on hovered section</div>
                    </div>
                </div>
                <div class="command-item">
                    <div class="command-content">
                        <div class="command-title"><kbd>esc</kbd> Close modal</div>
                    </div>
                </div>
            </div>
        </div>
    </div>
    <div id="lightbox-overlay" class="lightbox-overlay" style="display: none;">
        <div class="lightbox-content">
            <img id="lightbox-image" src="" alt="Lightbox Image">
            <div class="lightbox-close">&times;</div>
            <div id="lightbox-caption" class="lightbox-caption"></div>
        </div>
    </div>
    ${renderSidebar({ fileTree, currentPath, headings, currentColorScheme: config.colorScheme, isShared, static: isStatic, standalone })}
    <main class="content">
        <div class="content-wrapper">
            ${!isShared ? renderBreadcrumbs(currentPath, isStatic) : ''}
            <header class="article-header">
                <h1>${escapeHtml(title)}</h1>
                ${renderMetadata(frontmatter)}
                <div class="title-accent"></div>
            </header>
            ${content}
        </div>
    </main>
    ${renderRightOutline(headings)}
    ${(!isShared && !isStatic) ? `
    <script>
        // Close mobile sidebar on navigation
        document.addEventListener('click', (e) => {
            if (e.target.tagName === 'A' && document.body.classList.contains('sidebar-open')) {
                document.body.classList.remove('sidebar-open');
            }
        });
    </script>
    ` : ''
        }
    ${renderScripts(scripts, isStatic)}
</body>
</html>
`;
};

// Re-export shared types and functions that might be needed by other modules
export { renderHead } from './renderer/head.js';
export { renderSidebar } from './renderer/sidebar.js';
export { renderScripts } from './renderer/scripts.js';
export { renderMetadata, formatDate } from './renderer/metadata.js';
export { renderRightOutline } from './renderer/outline.js';
export { renderBreadcrumbs } from './renderer/breadcrumbs.js';
export { escapeHtml } from './utils/html.js';

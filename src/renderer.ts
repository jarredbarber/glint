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
    shareId?: string;
    scripts?: string[];
    styles?: string[];
}

export const renderHtml = (options: RenderOptions) => {
    const { content, title, config, fileTree, currentPath, headings = [], frontmatter = {}, access, shareId, scripts = [], styles = [] } = options;
    const isShared = !!shareId;

    return `
<!DOCTYPE html>
<html lang="en">
    ${renderHead(title, config.theme, styles)}
    <body class="${config.theme} ${isShared ? 'shared-view' : ''}" data-access="${access || 'edit'}" data-path="${escapeHtml(currentPath)}">
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
    ${renderSidebar({ fileTree, currentPath, headings, currentTheme: config.theme, isShared })}
    <main class="content">
        <div class="content-wrapper">
            ${!isShared ? renderBreadcrumbs(currentPath) : ''}
            <header class="article-header">
                <h1>${escapeHtml(title)}</h1>
                ${renderMetadata(frontmatter)}
                <div class="title-accent"></div>
            </header>
            ${content}
        </div>
    </main>
    ${renderRightOutline(headings)}
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
    ` : ''
        }
    ${renderScripts(shareId, scripts)}
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

import { escapeHtml } from './utils/html.js';

// File tree model + HTML renderer for the standalone `glint render` document.
export interface FileNode {
    name: string;
    path: string;
    displayName: string;
    isDir: boolean;
    children?: FileNode[];
}

export function renderFileTree(nodes: FileNode[], currentPath: string = ''): string {
    if (nodes.length === 0) return '';

    const items = nodes.map(node => {
        const isActive = node.path === currentPath;
        const activeClass = isActive ? ' class="active"' : '';

        if (node.isDir) {
            const isOpen = currentPath === node.path || currentPath.startsWith(node.path + '/');
            return `
        <li class="dir">
          <details ${isOpen ? 'open' : ''}>
            <summary>${escapeHtml(node.name)}/</summary>
            <ul>${renderFileTree(node.children || [], currentPath)}</ul>
          </details>
        </li>`;
        } else {
            return `<li${activeClass}><a href="/f/${node.path}">${escapeHtml(node.displayName)}</a></li>`;
        }
    }).join('\n');

    return items;
}

import fs from 'fs/promises';
import path from 'path';

export interface FileNode {
    name: string;
    path: string;
    isDir: boolean;
    children?: FileNode[];
}

export async function buildFileTree(dir: string, basePath: string = ''): Promise<FileNode[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const nodes: FileNode[] = [];

    for (const entry of entries) {
        // Skip hidden files, node_modules, assets, dist, and glint.json
        if (entry.name.startsWith('.') ||
            entry.name === 'node_modules' ||
            entry.name === 'assets' ||
            entry.name === 'dist' ||
            entry.name === 'glint.json') {
            continue;
        }

        const relativePath = path.join(basePath, entry.name);
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            const children = await buildFileTree(fullPath, relativePath);
            if (children.length > 0) {
                nodes.push({
                    name: entry.name,
                    path: relativePath,
                    isDir: true,
                    children,
                });
            }
        } else if (entry.name.endsWith('.md')) {
            nodes.push({
                name: entry.name.replace('.md', ''),
                path: relativePath.replace('.md', ''),
                isDir: false,
            });
        }
    }

    // Sort: Directories first, then alphabetical
    return nodes.sort((a, b) => {
        if (a.isDir && !b.isDir) return -1;
        if (!a.isDir && b.isDir) return 1;
        return a.name.localeCompare(b.name);
    });
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
            <summary>${escapeHtml(node.name)}</summary>
            <ul>${renderFileTree(node.children || [], currentPath)}</ul>
          </details>
        </li>`;
        } else {
            return `<li${activeClass}><a href="/${node.path}">${escapeHtml(node.name)}</a></li>`;
        }
    }).join('\n');

    return items;
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

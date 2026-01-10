import fs from 'fs/promises';
import path from 'path';

export interface FileNode {
    name: string;
    path: string;
    displayName: string;
    isDir: boolean;
    children?: FileNode[];
}

export async function buildFileTree(
    dir: string,
    basePath: string = '',
    titleCache?: Map<string, string>
): Promise<FileNode[]> {
    let entries;
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
        // Skip directories we can't access (permission denied, etc.)
        return [];
    }
    const nodes: FileNode[] = [];

    for (const entry of entries) {
        // Skip hidden files, node_modules, assets, dist, glint.json, and macOS protected dirs
        if (entry.name.startsWith('.') ||
            entry.name === 'node_modules' ||
            entry.name === 'assets' ||
            entry.name === 'dist' ||
            entry.name === 'glint.json' ||
            entry.name === 'Library') {
            continue;
        }

        const relativePath = path.join(basePath, entry.name);
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            try {
                const children = await buildFileTree(fullPath, relativePath);
                if (children.length > 0) {
                    nodes.push({
                        name: entry.name,
                        path: relativePath,
                        displayName: entry.name,
                        isDir: true,
                        children,
                    });
                }
            } catch {
                // Skip directories we can't access
            }
        } else if (entry.name.endsWith('.md')) {
            const nameWithoutExt = entry.name.replace('.md', '');
            const displayName = titleCache?.get(relativePath) || nameWithoutExt;
            nodes.push({
                name: entry.name.replace('.md', ''),
                path: relativePath.replace('.md', ''),
                displayName,
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
            return `<li${activeClass}><a href="/${node.path}">${escapeHtml(node.displayName)}</a></li>`;
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

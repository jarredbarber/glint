import { FileMeta } from './storage/types.js';

export interface FolderNode {
    kind: 'folder';
    name: string;
    path: string;
    children: TreeNode[];
}

export interface FileNode {
    kind: 'file';
    name: string;
    file: FileMeta;
}

export type TreeNode = FolderNode | FileNode;

interface MutableFolder extends FolderNode {
    folders: Map<string, MutableFolder>;
}

function compareNodes(a: TreeNode, b: TreeNode): number {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
}

function finalize(folder: MutableFolder): TreeNode[] {
    const children: TreeNode[] = [
        ...Array.from(folder.folders.values(), (child): FolderNode => ({
            kind: 'folder',
            name: child.name,
            path: child.path,
            children: finalize(child),
        })),
        ...folder.children,
    ];
    return children.sort(compareNodes);
}

/** Build a source-root-relative navigation tree from adapter paths. */
export function buildFileTree(files: FileMeta[]): TreeNode[] {
    const root: MutableFolder = { kind: 'folder', name: '', path: '', children: [], folders: new Map() };

    for (const file of files) {
        const parts = file.path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
        const fileName = parts.pop() ?? file.name;
        let parent = root;
        for (const part of parts) {
            let child = parent.folders.get(part);
            if (!child) {
                const path = parent.path ? `${parent.path}/${part}` : part;
                child = { kind: 'folder', name: part, path, children: [], folders: new Map() };
                parent.folders.set(part, child);
            }
            parent = child;
        }
        parent.children.push({ kind: 'file', name: fileName, file });
    }

    return finalize(root);
}

import type { TaskItem, TaskMetadata, TaskState } from './types.js';

export function parseTaskLine(line: string, filePath: string, lineNumber: number): TaskItem | null {
    // Basic task regex: - [ ] description
    const taskMatch = line.match(/^(\s*)-\s*\[([ x/wbc])\]\s*(.*)$/i);
    if (!taskMatch) return null;

    const [, , marker, contentWithMeta] = taskMatch;

    // Determine state
    let state: TaskState = 'open';
    const m = marker.toLowerCase();
    if (m === 'x') state = 'done';
    else if (m === '/') state = 'progress';
    else if (m === 'w') state = 'waiting';
    else if (m === 'b') state = 'blocked';
    else if (m === 'c') state = 'cancelled';

    // Extract metadata from end (parentheses)
    const metadata: TaskMetadata = {};
    let description = contentWithMeta.trim();

    const metaMatch = description.match(/\s*\(([^)]+)\)$/);
    if (metaMatch) {
        const inner = metaMatch[1];
        const parts = inner.split(/\s+/);
        for (const part of parts) {
            if (part.startsWith('@')) {
                metadata.assignee = part.slice(1);
            } else if (part.startsWith('#')) {
                metadata.priority = part.slice(1);
            } else if (part.includes(':')) {
                const [key, value] = part.split(':');
                metadata[key] = value;
            }
        }
        // Strip metadata from description
        description = description.slice(0, description.length - metaMatch[0].length).trim();
    }

    return {
        id: `${filePath}:${lineNumber}`,
        state,
        description,
        metadata,
        sourcePath: filePath,
        lineNumber,
        raw: line
    };
}

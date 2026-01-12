export type TaskState = 'open' | 'done' | 'progress' | 'waiting' | 'blocked' | 'cancelled';

export interface TaskMetadata {
    priority?: string;
    assignee?: string;
    due?: string;
    remind?: string;
    created?: string;
    completed?: string;
    scheduled?: string;
    [key: string]: string | undefined;
}

export interface TaskItem {
    id: string; // Composite ID: filePath + line
    state: TaskState;
    description: string;
    metadata: TaskMetadata;
    sourcePath: string; // Relative to content root
    lineNumber: number;
    raw: string; // Original markdown line
}

export interface FileTasks {
    path: string;
    mtime: number;
    tasks: TaskItem[];
}

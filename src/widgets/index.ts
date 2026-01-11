import type { WidgetHandler } from './types.js';
import { taskHandler } from './task.js';
import { commentHandler } from './comment.js';

export const widgets: WidgetHandler[] = [
    taskHandler,
    commentHandler
];

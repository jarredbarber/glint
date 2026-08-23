import type { WidgetHandler } from './types.js';
import { taskHandler } from './task.js';

export const widgets: WidgetHandler[] = [taskHandler];

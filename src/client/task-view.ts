import type { TaskItem } from '../tasks/types.js';
import { injectTaskInteractions } from './editor-tasks.js';

class TaskView {
    private root: HTMLElement;
    private tasks: TaskItem[] = [];
    private filter: string = 'active'; // 'active' | 'all' | 'recently-completed'
    private groupBy: string = 'file'; // 'file'
    private recencyDays: number = 7;

    constructor(elementId: string) {
        this.root = document.getElementById(elementId) as HTMLElement;
        if (!this.root) return;
        this.init();
    }

    async init() {
        await this.fetchTasks();
        this.render();
        this.setupEventListeners();
    }

    async fetchTasks() {
        try {
            const response = await fetch('/api/tasks');
            this.tasks = await response.json();
        } catch (error) {
            console.error('Failed to fetch tasks:', error);
            this.root.innerHTML = '<div class="error">Failed to load tasks.</div>';
        }
    }

    setupEventListeners() {
        // We handle general clicks like presets here
        // Task-specific clicks are handled by injectTaskInteractions
    }

    render() {
        if (this.tasks.length === 0) {
            this.root.innerHTML = '<div class="empty-state">No tasks found.</div>';
            return;
        }

        let filteredTasks = this.tasks;
        if (this.filter === 'active') {
            filteredTasks = this.tasks.filter(t => t.state !== 'done' && t.state !== 'cancelled');
        } else if (this.filter === 'recently-completed') {
            const now = new Date();
            const threshold = new Date(now.getTime() - (this.recencyDays * 24 * 60 * 60 * 1000));

            filteredTasks = this.tasks.filter(t => {
                // Include active tasks
                if (t.state !== 'done' && t.state !== 'cancelled') return true;

                // Include recently completed
                if (t.state === 'done') {
                    const completedStr = t.metadata.completed;
                    if (!completedStr) return false;
                    const completedDate = new Date(completedStr);
                    return completedDate >= threshold;
                }
                return false;
            });
        }

        // Apply natural sorting
        const sortedTasks = this.sortTasksNaturally(filteredTasks);

        let html = `
            <div class="task-controls">
                <div class="control-row">
                    <div class="control-group">
                        <label>Filter:</label>
                        <select id="task-filter">
                            <option value="active" ${this.filter === 'active' ? 'selected' : ''}>Active</option>
                            <option value="all" ${this.filter === 'all' ? 'selected' : ''}>All Tasks</option>
                            <option value="recently-completed" ${this.filter === 'recently-completed' ? 'selected' : ''}>Recent + Active</option>
                        </select>
                    </div>
                    
                    <button id="copy-report-btn" class="report-btn" title="Copy visible tasks as Markdown">
                        📋 Copy Report
                    </button>
                </div>
                
                <div class="control-row recency-row" style="display: ${this.filter === 'recently-completed' ? 'flex' : 'none'}">
                    <div class="control-group">
                        <label>For past:</label>
                        <div class="presets">
                            <button class="preset-btn ${this.recencyDays === 1 ? 'active' : ''}" data-days="1">1d</button>
                            <button class="preset-btn ${this.recencyDays === 7 ? 'active' : ''}" data-days="7">7d</button>
                            <button class="preset-btn ${this.recencyDays === 30 ? 'active' : ''}" data-days="30">30d</button>
                        </div>
                    </div>
                    <div class="control-group slider-group">
                        <input type="range" id="recency-slider" min="1" max="90" value="${this.recencyDays}">
                        <span id="recency-value">${this.recencyDays} days</span>
                    </div>
                </div>
            </div>
            
            <ul class="task-list flat-list">
                ${sortedTasks.map(task => this.renderTask(task)).join('')}
            </ul>
        `;

        this.root.innerHTML = html;

        this.attachUIEvents();

        // Inject rich interactions
        injectTaskInteractions(this.root, async () => {
            // Callback after a task update - refresh the dashboard
            await this.fetchTasks();
            this.render();
        });
    }

    sortTasksNaturally(tasks: TaskItem[]): TaskItem[] {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

        return [...tasks].sort((a, b) => {
            // 1. Completion State (Completed/Cancelled go to bottom)
            const aDone = a.state === 'done' || a.state === 'cancelled';
            const bDone = b.state === 'done' || b.state === 'cancelled';
            if (aDone && !bDone) return 1;
            if (!aDone && bDone) return -1;

            // If both done, sort by completion date (newest first)
            if (aDone && bDone) {
                const da = new Date(a.metadata.completed || 0).getTime();
                const db = new Date(b.metadata.completed || 0).getTime();
                return db - da;
            }

            // 2. Due Dates (Overdue & Today first)
            const getDueDate = (t: TaskItem) => t.metadata.due ? new Date(t.metadata.due).getTime() : null;
            const aDue = getDueDate(a);
            const bDue = getDueDate(b);

            if (aDue && bDue) {
                // Both have due dates - Ascending Order (Earliest first)
                if (aDue !== bDue) return aDue - bDue;
            } else if (aDue) {
                // A has due date
                if (aDue <= today) return -1; // Overdue/Today -> Top
            } else if (bDue) {
                // B has due date
                if (bDue <= today) return 1; // Overdue/Today -> Top
            }

            // 3. Priority
            const getPriorityScore = (t: TaskItem) => {
                const p = (t.metadata.priority || '').toLowerCase();
                if (['urgent', 'p0', 'critical'].includes(p)) return 4;
                if (['high', 'p1'].includes(p)) return 3;
                if (['medium', 'p2'].includes(p)) return 2;
                if (['low', 'p3'].includes(p)) return 1;
                return 0;
            };
            const aScore = getPriorityScore(a);
            const bScore = getPriorityScore(b);
            if (aScore !== bScore) return bScore - aScore; // Highest priority first

            // 4. Due Soon (Within 7 days)
            // Already effectively handled by due date sort above if both have dates.
            // But if one has a date (future) and other doesn't?
            // Let's prefer items with due dates over those without.
            if (aDue && !bDue) return -1;
            if (!aDue && bDue) return 1;

            // 5. Creation Date (Newest first)
            const getCreated = (t: TaskItem) => t.metadata.created ? new Date(t.metadata.created).getTime() : 0;
            const aCreated = getCreated(a);
            const bCreated = getCreated(b);
            if (aCreated !== bCreated) return bCreated - aCreated;

            // 6. File Path (Group similar files potentially)
            if (a.sourcePath !== b.sourcePath) return a.sourcePath.localeCompare(b.sourcePath);

            // 7. Line Number
            return a.lineNumber - b.lineNumber;
        });
    }

    private attachUIEvents() {
        // Re-attach filter & slider listeners
        const filterSelect = document.getElementById('task-filter') as HTMLSelectElement;
        if (filterSelect) {
            filterSelect.onchange = (e) => {
                this.filter = (e.target as HTMLSelectElement).value;
                this.render();
            };
        }

        const slider = document.getElementById('recency-slider') as HTMLInputElement;
        const sliderValue = document.getElementById('recency-value');
        if (slider && sliderValue) {
            slider.oninput = (e) => {
                const val = (e.target as HTMLInputElement).value;
                sliderValue.innerText = `${val} days`;
            };
            slider.onchange = (e) => {
                this.recencyDays = parseInt((e.target as HTMLInputElement).value);
                this.render();
            };
        }

        const presetBtns = document.querySelectorAll('.preset-btn');
        presetBtns.forEach(btn => {
            (btn as HTMLElement).onclick = () => {
                this.recencyDays = parseInt((btn as HTMLElement).dataset.days!);
                this.render();
            };
        });

        const copyBtn = document.getElementById('copy-report-btn');
        if (copyBtn) {
            copyBtn.onclick = () => this.copyAsMarkdown();
        }
    }

    async copyAsMarkdown() {
        // Updated copy logic to respect new sorting
        let md = `# Status Report (${new Date().toLocaleDateString()})\n\n`;

        let filteredTasks = this.tasks;
        // ... (Filter logic matches render) ...
        if (this.filter === 'active') {
            filteredTasks = this.tasks.filter(t => t.state !== 'done' && t.state !== 'cancelled');
        } else if (this.filter === 'recently-completed') {
            const threshold = new Date(Date.now() - (this.recencyDays * 24 * 60 * 60 * 1000));
            filteredTasks = this.tasks.filter(t => {
                if (t.state !== 'done' && t.state !== 'cancelled') return true;
                if (t.state === 'done') return new Date(t.metadata.completed || 0) >= threshold;
                return false;
            });
        }

        const sortedTasks = this.sortTasksNaturally(filteredTasks);

        for (const t of sortedTasks) {
            const stateChar = t.state === 'done' ? 'x' : t.state === 'open' ? ' ' : t.state === 'progress' ? '/' : t.state === 'waiting' ? 'w' : t.state === 'blocked' ? 'b' : 'c';
            md += `- [${stateChar}] ${t.description}`;
            const metaFields = Object.entries(t.metadata)
                .filter(([k, v]) => !!v && k !== 'completed')
                .map(([k, v]) => k === 'assignee' ? `@${v}` : k === 'priority' ? `#${v}` : `${k}:${v}`)
                .join(' ');
            // Add source context
            md += ` ([${t.sourcePath}](${t.sourcePath}))`;
            if (metaFields) md += ` (${metaFields})`;
            md += `\n`;
        }

        await navigator.clipboard.writeText(md);

        const btn = document.getElementById('copy-report-btn');
        if (btn) {
            const originalText = btn.innerHTML;
            btn.innerHTML = '✅ Copied!';
            setTimeout(() => btn.innerHTML = originalText, 2000);
        }
    }

    renderTask(task: TaskItem) {
        const icons: Record<string, string> = {
            open: '🟦',
            done: '✅',
            progress: '🏃',
            waiting: '⌛',
            blocked: '⛔',
            cancelled: '🚫'
        };

        const metaHtml = Object.entries(task.metadata)
            .filter(([k, v]) => !!v && !['completed', 'created'].includes(k))
            .map(([k, v]) => {
                const className = `meta-${k}`;
                const label = k === 'assignee' ? `@${v}` : k === 'priority' ? `#${v}` : `${k}:${v}`;
                return `<span class="${className}">${label}</span>`;
            })
            .join('');

        const link = `/${task.sourcePath}#L${task.lineNumber}`;

        // Return HTML matching the widget structure for consistent styling and behavior
        return `
            <li class="glint-task" 
                data-state="${task.state}"
                data-source-path="${task.sourcePath}"
                data-source-line="${task.lineNumber}">
                <div class="glint-task-header">
                    <span class="glint-task-check" title="Change state">${icons[task.state] || '🟦'}</span>
                    <div class="glint-task-content-row">
                        <div class="task-info-column">
                            <a href="${link}" class="glint-task-content">${task.description}</a>
                            <div class="task-view-location">
                                <a href="${link}" class="file-badge">${task.sourcePath}:${task.lineNumber}</a>
                            </div>
                        </div>
                        <span class="glint-task-meta">${metaHtml}</span>
                    </div>
                </div>
            </li>
        `;
    }
}

// Initialize
function initTaskView() {
    const root = document.getElementById('task-view-root');
    if (root && !root.dataset.initialized) {
        root.dataset.initialized = 'true';
        new TaskView('task-view-root');
    }
}

document.addEventListener('DOMContentLoaded', initTaskView);
document.addEventListener('glint:navigated', initTaskView);


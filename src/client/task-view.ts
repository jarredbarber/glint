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

            // Sort: Active first, then Recently Completed (newest first)
            filteredTasks.sort((a, b) => {
                const isAActive = a.state !== 'done' && a.state !== 'cancelled';
                const isBActive = b.state !== 'done' && b.state !== 'cancelled';
                if (isAActive && !isBActive) return -1;
                if (!isAActive && isBActive) return 1;

                if (a.state === 'done' && b.state === 'done') {
                    const da = new Date(a.metadata.completed || 0).getTime();
                    const db = new Date(b.metadata.completed || 0).getTime();
                    return db - da;
                }
                return 0;
            });
        }

        // Group by file
        const groups: Record<string, TaskItem[]> = {};
        for (const task of filteredTasks) {
            if (!groups[task.sourcePath]) groups[task.sourcePath] = [];
            groups[task.sourcePath].push(task);
        }

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
        `;

        for (const [filePath, fileTasks] of Object.entries(groups)) {
            html += `
                <section class="task-file-group">
                    <h2 class="file-header"><a href="/${filePath}">${filePath}</a></h2>
                    <ul class="task-list">
                        ${fileTasks.map(this.renderTask).join('')}
                    </ul>
                </section>
            `;
        }

        this.root.innerHTML = html;

        this.attachUIEvents();

        // Inject rich interactions
        injectTaskInteractions(this.root, async () => {
            // Callback after a task update - refresh the dashboard
            await this.fetchTasks();
            this.render();
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
        // Logic to export current filtered view as MD
        let md = `# Status Report (${new Date().toLocaleDateString()})\n\n`;

        let filteredTasks = this.tasks;
        if (this.filter === 'active') {
            filteredTasks = this.tasks.filter(t => t.state !== 'done' && t.state !== 'cancelled');
        } else if (this.filter === 'recently-completed') {
            const threshold = new Date(Date.now() - (this.recencyDays * 24 * 60 * 60 * 1000));
            filteredTasks = this.tasks.filter(t => {
                if (t.state !== 'done' && t.state !== 'cancelled') return true;
                if (t.state === 'done') {
                    return new Date(t.metadata.completed || 0) >= threshold;
                }
                return false;
            });
            // Sort: Active first, then Recent
            filteredTasks.sort((a, b) => {
                const isAActive = a.state !== 'done' && a.state !== 'cancelled';
                const isBActive = b.state !== 'done' && b.state !== 'cancelled';
                if (isAActive && !isBActive) return -1;
                if (!isAActive && isBActive) return 1;
                if (a.state === 'done' && b.state === 'done') {
                    const da = new Date(a.metadata.completed || 0).getTime();
                    const db = new Date(b.metadata.completed || 0).getTime();
                    return db - da;
                }
                return 0;
            });
        }

        const groups: Record<string, TaskItem[]> = {};
        for (const task of filteredTasks) {
            if (!groups[task.sourcePath]) groups[task.sourcePath] = [];
            groups[task.sourcePath].push(task);
        }

        for (const [file, tasks] of Object.entries(groups)) {
            md += `## ${file}\n`;
            for (const t of tasks) {
                const stateChar = t.state === 'done' ? 'x' : t.state === 'open' ? ' ' : t.state === 'progress' ? '/' : t.state === 'waiting' ? 'w' : t.state === 'blocked' ? 'b' : 'c';
                md += `- [${stateChar}] ${t.description}`;
                const metaFields = Object.entries(t.metadata)
                    .filter(([k, v]) => !!v && k !== 'completed')
                    .map(([k, v]) => k === 'assignee' ? `@${v}` : k === 'priority' ? `#${v}` : `${k}:${v}`)
                    .join(' ');
                if (metaFields) md += ` (${metaFields})`;
                md += `\n`;
            }
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
                                <a href="${link}">Line ${task.lineNumber}</a>
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


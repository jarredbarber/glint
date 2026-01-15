import type { DateGroup, JournalSection } from '../journal/types.js';

class JournalView {
    private root: HTMLElement;
    private groups: DateGroup[] = [];

    constructor(elementId: string) {
        this.root = document.getElementById(elementId) as HTMLElement;
        if (!this.root) return;
        this.init();
    }

    async init() {
        await this.fetchJournal();
        this.render();
    }

    async fetchJournal() {
        try {
            const response = await fetch('/api/journal');
            this.groups = await response.json();
        } catch (error) {
            console.error('Failed to fetch journal:', error);
            this.root.innerHTML = '<div class="error">Failed to load journal.</div>';
        }
    }

    render() {
        if (this.groups.length === 0) {
            this.root.innerHTML = '<div class="empty-state">No journal entries found. Add dated headings (## YYYY-MM-DD) to your notes to see them here.</div>';
            return;
        }

        let html = `
            <div class="journal-controls">
                <div class="control-row">
                    <h1>Journal View</h1>
                </div>
            </div>
            <div class="journal-timeline">
        `;

        for (const group of this.groups) {
            html += `
                <div class="journal-date-group">
                    <h2 class="date-header">${this.formatDate(group.date)}</h2>
                    <div class="date-sections">
                        ${group.sections.map(s => this.renderSection(s)).join('')}
                    </div>
                </div>
            `;
        }

        html += `</div>`;
        this.root.innerHTML = html;
    }

    private formatDate(dateStr: string): string {
        try {
            const date = new Date(dateStr);
            return date.toLocaleDateString(undefined, {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
        } catch {
            return dateStr;
        }
    }

    private renderSection(section: JournalSection) {
        const link = `/${section.file}#L${section.startLine}`;

        // Use pre-rendered HTML if available, otherwise escape raw content
        const contentHtml = section.renderedContent
            ? section.renderedContent
            : section.content
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\n/g, '<br>');

        return `
            <div class="journal-section">
                <div class="section-meta">
                    <a href="${link}" class="file-name">${section.fileTitle}</a>
                    <span class="line-meta">Line ${section.startLine}</span>
                </div>
                <div class="section-content">
                    <div class="content-preview">${contentHtml}</div>
                </div>
            </div>
        `;
    }
}

// Initialize
function initJournalView() {
    const root = document.getElementById('journal-view-root');
    if (root && !root.dataset.initialized) {
        root.dataset.initialized = 'true';
        new JournalView('journal-view-root');
    }
}

document.addEventListener('DOMContentLoaded', initJournalView);
document.addEventListener('glint:navigated', initJournalView);

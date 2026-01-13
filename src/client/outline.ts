/**
 * Right-margin outline with active section tracking and collapse/expand functionality
 */

interface OutlineState {
    activeId: string | null;
    collapsedSections: Set<string>;
}

class OutlineManager {
    private state: OutlineState = {
        activeId: null,
        collapsedSections: new Set()
    };
    private observer: IntersectionObserver | null = null;
    private headingElements: HTMLElement[] = [];
    private outlineContainer: HTMLElement | null = null;
    private storageKey = 'glint-outline-collapsed';

    constructor() {
        this.loadCollapsedState();
    }

    init(): void {
        this.outlineContainer = document.querySelector('.right-outline');
        if (!this.outlineContainer) return;

        const contentArea = document.querySelector('main.content');
        if (!contentArea) return;

        this.headingElements = Array.from(
            contentArea.querySelectorAll('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]')
        ) as HTMLElement[];

        if (this.headingElements.length === 0) return;

        this.setupIntersectionObserver();
        this.setupCollapseHandlers();
        this.applyCollapsedStates();
    }

    private setupIntersectionObserver(): void {
        if (this.observer) {
            this.observer.disconnect();
        }

        const options: IntersectionObserverInit = {
            root: null,
            rootMargin: '-20% 0px -70% 0px',
            threshold: [0, 0.25, 0.5, 0.75, 1]
        };

        this.observer = new IntersectionObserver((entries) => {
            let mostVisible: { entry: IntersectionObserverEntry; ratio: number } | null = null;

            for (const entry of entries) {
                if (entry.isIntersecting && entry.intersectionRatio > 0) {
                    if (!mostVisible || entry.intersectionRatio > mostVisible.ratio) {
                        mostVisible = { entry, ratio: entry.intersectionRatio };
                    }
                }
            }

            if (mostVisible) {
                const headingId = mostVisible.entry.target.getAttribute('id');
                if (headingId) {
                    this.updateActiveHeading(headingId);
                }
            }
        }, options);

        this.headingElements.forEach(heading => {
            this.observer?.observe(heading);
        });
    }

    private setupCollapseHandlers(): void {
        if (!this.outlineContainer) return;

        const toggles = this.outlineContainer.querySelectorAll('.outline-toggle');
        toggles.forEach(toggle => {
            toggle.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                const sectionId = toggle.getAttribute('data-section-id');
                if (sectionId) {
                    this.toggleSection(sectionId);
                }
            });
        });
    }

    private updateActiveHeading(headingId: string): void {
        if (this.state.activeId === headingId) return;

        if (this.state.activeId) {
            const oldLink = this.outlineContainer?.querySelector(
                `.right-outline-link[href="#${this.state.activeId}"]`
            );
            oldLink?.classList.remove('active');
        }

        this.state.activeId = headingId;
        const newLink = this.outlineContainer?.querySelector(
            `.right-outline-link[href="#${headingId}"]`
        );
        newLink?.classList.add('active');
    }

    private toggleSection(sectionId: string): void {
        const section = this.outlineContainer?.querySelector(
            `.right-outline-section[data-section-id="${sectionId}"]`
        );
        if (!section) return;

        if (this.state.collapsedSections.has(sectionId)) {
            this.state.collapsedSections.delete(sectionId);
            section.classList.remove('collapsed');
        } else {
            this.state.collapsedSections.add(sectionId);
            section.classList.add('collapsed');
        }

        this.saveCollapsedState();
    }

    private applyCollapsedStates(): void {
        this.state.collapsedSections.forEach(sectionId => {
            const section = this.outlineContainer?.querySelector(
                `.right-outline-section[data-section-id="${sectionId}"]`
            );
            section?.classList.add('collapsed');
        });
    }

    private loadCollapsedState(): void {
        try {
            const stored = localStorage.getItem(this.storageKey);
            if (stored) {
                this.state.collapsedSections = new Set(JSON.parse(stored));
            }
        } catch (e) {
            console.warn('Failed to load outline collapsed state:', e);
        }
    }

    private saveCollapsedState(): void {
        try {
            localStorage.setItem(
                this.storageKey,
                JSON.stringify(Array.from(this.state.collapsedSections))
            );
        } catch (e) {
            console.warn('Failed to save outline collapsed state:', e);
        }
    }

    destroy(): void {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        this.headingElements = [];
        this.outlineContainer = null;
    }
}

let manager: OutlineManager | null = null;

function initOutline() {
    if (manager) {
        manager.destroy();
    }
    manager = new OutlineManager();
    manager.init();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOutline);
} else {
    initOutline();
}

document.addEventListener('glint:navigated', initOutline);

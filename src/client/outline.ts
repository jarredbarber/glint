/**
 * Right-margin outline with active section tracking and collapse/expand functionality
 */

interface OutlineState {
    activeId: string | null;
    collapsedSections: Set<string>;
    hidden: boolean;
}

class OutlineManager {
    private state: OutlineState = {
        activeId: null,
        collapsedSections: new Set(),
        hidden: false
    };
    private observer: IntersectionObserver | null = null;
    private headingElements: HTMLElement[] = [];
    private outlineContainer: HTMLElement | null = null;
    private reopenBtn: HTMLElement | null = null;
    private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
    private storageKey = 'glint-outline-collapsed';
    private visibilityKey = 'glint-outline-hidden';

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
        this.setupLinkClicks(contentArea as HTMLElement);
        this.setupToggleButton();
        this.setupKeyboardShortcut();
        this.applyCollapsedStates();
        this.applyVisibilityState();
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

    private setupLinkClicks(contentArea: HTMLElement): void {
        if (!this.outlineContainer) return;

        this.outlineContainer.addEventListener('click', (e) => {
            const link = (e.target as HTMLElement).closest('a.right-outline-link');
            if (!link) return;

            const href = link.getAttribute('href');
            if (!href || !href.startsWith('#')) return;

            const targetId = href.slice(1);
            const target = document.getElementById(targetId);
            if (!target) return;

            e.preventDefault();
            // Walk offsetParent chain to get the true document-flow position,
            // since getBoundingClientRect() returns the sticky-pinned position
            let top = 0;
            let el: HTMLElement | null = target;
            while (el && el !== contentArea) {
                top += el.offsetTop;
                el = el.offsetParent as HTMLElement | null;
            }
            const scrollMargin = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
            contentArea.scrollTo({
                top: top - scrollMargin,
                behavior: 'smooth'
            });
            history.replaceState(null, '', href);
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

    // Visibility is session-only (not persisted) to avoid flash-on-load

    private applyVisibilityState(): void {
        if (!this.outlineContainer) return;
        if (this.state.hidden) {
            this.outlineContainer.classList.add('outline-hidden');
        } else {
            this.outlineContainer.classList.remove('outline-hidden');
        }
        if (this.reopenBtn) {
            this.reopenBtn.style.display = this.state.hidden ? '' : 'none';
        }
    }

    private toggleVisibility(): void {
        if (!this.outlineContainer) return;
        this.outlineContainer.classList.add('outline-transitioning');
        this.state.hidden = !this.state.hidden;
        this.applyVisibilityState();
    }

    private setupToggleButton(): void {
        if (!this.outlineContainer) return;

        // Create toggle button inside outline
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'outline-visibility-toggle';
        toggleBtn.innerHTML = '‹';
        toggleBtn.title = 'Toggle outline (O)';
        toggleBtn.setAttribute('aria-label', 'Toggle outline visibility');
        toggleBtn.onclick = () => this.toggleVisibility();

        const header = this.outlineContainer.querySelector('.right-outline-header');
        if (header) {
            header.appendChild(toggleBtn);
        } else {
            this.outlineContainer.insertBefore(toggleBtn, this.outlineContainer.firstChild);
        }

        // Create external reopen button (visible only when outline is hidden)
        let existing = document.querySelector('.outline-reopen-toggle');
        if (existing) existing.remove();

        this.reopenBtn = document.createElement('button');
        this.reopenBtn.className = 'outline-reopen-toggle';
        this.reopenBtn.innerHTML = '☰';
        this.reopenBtn.title = 'Show outline (O)';
        this.reopenBtn.setAttribute('aria-label', 'Show outline');
        this.reopenBtn.style.display = 'none';
        this.reopenBtn.onclick = () => this.toggleVisibility();
        document.body.appendChild(this.reopenBtn);
    }

    private setupKeyboardShortcut(): void {
        this.keydownHandler = (e: KeyboardEvent) => {
            // Only trigger if not in an input/textarea/editor
            if (e.target instanceof HTMLInputElement ||
                e.target instanceof HTMLTextAreaElement ||
                (window as any).__glintEditingActive) {
                return;
            }

            // Press 'o' to toggle outline
            if (e.key === 'o' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
                e.preventDefault();
                this.toggleVisibility();
            }
        };
        document.addEventListener('keydown', this.keydownHandler);
    }

    destroy(): void {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        if (this.reopenBtn) {
            this.reopenBtn.remove();
            this.reopenBtn = null;
        }
        if (this.keydownHandler) {
            document.removeEventListener('keydown', this.keydownHandler);
            this.keydownHandler = null;
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

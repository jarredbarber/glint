
/**
 * Editor Integration Coordinator
 * Orchestrates various specialized modules for the editing experience.
 */

import { setupClipboardListeners, getHasClipboardImage } from './clipboard.js';
import { injectEditIcons } from './editor-icons.js';
import { injectTaskInteractions } from './editor-tasks.js';
import { injectCommentInteractions } from './editor-comments.js';
import { setupKeyboardShortcuts } from './editor-shortcuts.js';
import { canEdit, canComment } from './permissions.js';

// Extend Window interface for global editing state (compatibility)
declare global {
    interface Window {
        __glintEditingActive?: boolean;
        __glintPendingReload?: boolean;
    }
}

document.addEventListener('DOMContentLoaded', () => {

    function updateLineTrackerHint() {
        const hint = document.querySelector('.line-tracker-hint') as HTMLElement;
        if (!hint) return;

        const existingLine = hint.querySelector('.hint-key')?.textContent?.match(/L(\d+)/)?.[1];
        if (existingLine) {
            let hintHtml = `<span class="hint-item"><span class="hint-key">L${existingLine}</span></span>`;
            if (canComment()) {
                hintHtml += `<span class="hint-item"><span class="hint-key">c</span> comment</span>`;
            }
            if (canEdit()) {
                hintHtml += `<span class="hint-item"><span class="hint-key">e</span> edit</span>`;
            }
            if (getHasClipboardImage()) {
                hintHtml += `<span class="hint-item"><span class="hint-key">⌘V</span> paste image</span>`;
            }
            hint.innerHTML = hintHtml;
        }
    }

    // Initialize specialized modules
    setupClipboardListeners(() => {
        updateLineTrackerHint();
    });

    function setupLineTracker() {
        if (!canComment() && !canEdit()) return;
        if (document.querySelector('.glint-line-tracker')) return;

        const content = document.querySelector('.content-wrapper') as HTMLElement;
        if (!content) return;

        const tracker = document.createElement('div');
        tracker.className = 'glint-line-tracker';
        tracker.innerHTML = `
            <div class="glint-line-visual"></div>
            <div class="line-tracker-hint"></div>
        `;
        const visual = tracker.querySelector('.glint-line-visual') as HTMLElement;
        const hint = tracker.querySelector('.line-tracker-hint') as HTMLElement;
        document.body.appendChild(tracker);

        let isVisible = false;

        content.addEventListener('mousemove', (e) => {
            const target = e.target as HTMLElement;
            const focusedSection = target.closest('.content-wrapper > [data-source-line]') as HTMLElement;

            if (focusedSection) {
                const rect = focusedSection.getBoundingClientRect();
                const contentRect = content.getBoundingClientRect();
                const sourceLine = focusedSection.getAttribute('data-source-line');

                let hintHtml = `<span class="hint-item"><span class="hint-key">L${sourceLine || '?'}</span></span>`;
                if (canComment()) {
                    hintHtml += `<span class="hint-item"><span class="hint-key">c</span> comment</span>`;
                }
                if (canEdit()) {
                    hintHtml += `<span class="hint-item"><span class="hint-key">e</span> edit</span>`;
                }
                if (getHasClipboardImage()) {
                    hintHtml += `<span class="hint-item"><span class="hint-key">⌘V</span> paste image</span>`;
                }
                hint.innerHTML = hintHtml;

                let targetY = rect.bottom;
                let nextSection = focusedSection.nextElementSibling as HTMLElement;
                while (nextSection && !nextSection.hasAttribute('data-source-line')) {
                    nextSection = nextSection.nextElementSibling as HTMLElement;
                }

                if (nextSection) {
                    const nextRect = nextSection.getBoundingClientRect();
                    targetY = (rect.bottom + nextRect.top) / 2;
                    hint.dataset.nextLine = nextSection.getAttribute('data-source-line') || '';
                } else {
                    targetY = rect.bottom + 8;
                    hint.dataset.nextLine = '';
                }

                tracker.style.top = `${targetY}px`;
                visual.style.left = `${contentRect.left}px`;
                visual.style.width = `${contentRect.width}px`;

                if (!isVisible) {
                    tracker.classList.add('visible');
                    isVisible = true;
                }
            } else {
                if (isVisible) {
                    tracker.classList.remove('visible');
                    isVisible = false;
                }
            }
        });

        content.addEventListener('mouseleave', () => {
            tracker.classList.remove('visible');
            isVisible = false;
        });

        const observer = new MutationObserver(() => {
            if (window.__glintEditingActive) {
                tracker.style.display = 'none';
            } else {
                tracker.style.display = '';
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    function init() {
        injectEditIcons();
        injectTaskInteractions();
        injectCommentInteractions();
        setupKeyboardShortcuts();
        setupLineTracker();

        // Initialize drag-to-reorder (if available)
        if (typeof (window as any).initDragReorder === 'function') {
            (window as any).initDragReorder();
        }
    }

    init();
    document.addEventListener('glint:navigated', init);
});

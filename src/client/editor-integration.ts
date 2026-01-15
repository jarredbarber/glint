
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
import './types.js';

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

        const content = document.querySelector('.content-wrapper') as HTMLElement;
        if (!content) return;

        let tracker = document.querySelector('.glint-line-tracker') as HTMLElement;
        if (!tracker) {
            tracker = document.createElement('div');
            tracker.className = 'glint-line-tracker';
            tracker.innerHTML = `
                <div class="glint-line-visual"></div>
                <div class="line-tracker-hint"></div>
            `;
            document.body.appendChild(tracker);
        }

        const visual = tracker.querySelector('.glint-line-visual') as HTMLElement;
        const hint = tracker.querySelector('.line-tracker-hint') as HTMLElement;

        let isVisible = false;
        let lastX = 0;
        let lastY = 0;

        function updateTracker(x: number, y: number, show: boolean) {
            // Check if element at point is valid
            // We need to temporarily hide the tracker/visual to peek 'under' it if it's in the way
            // But usually pointer-events: none handles that on the tracker container?
            // The tracker CSS has pointer-events: none for the container, but auto for the hint/toast.
            // visual is just a div.

            const target = document.elementFromPoint(x, y) as HTMLElement;
            if (!target) return;

            const focusedSection = target.closest('[data-source-line]') as HTMLElement;
            if (focusedSection && !content.contains(focusedSection)) return;

            if (focusedSection) {
                const rect = focusedSection.getBoundingClientRect();
                const contentRect = content.getBoundingClientRect();
                const sourceLine = focusedSection.getAttribute('data-source-line');

                // Store line in dataset for robust access by shortcuts
                if (sourceLine) {
                    hint.dataset.line = sourceLine;
                } else {
                    delete hint.dataset.line;
                }

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

                // Calculate left position for the badge
                const hintWidth = hint.getBoundingClientRect().width || 60; // fallback width
                const sidebarWidth = 250;
                let hintLeft = contentRect.left - hintWidth - 12;

                // Prevent overlap with sidebar if possible, but prioritize visibility near content
                // If it goes too far left, just let it be, z-index handles overlap if valid
                if (hintLeft < sidebarWidth + 10) {
                    // If really tight, just stick it to the edge of the content
                    hintLeft = contentRect.left - hintWidth - 8;
                }

                hint.style.left = `${hintLeft}px`;

                if (show && !isVisible) {
                    tracker.classList.add('visible');
                    isVisible = true;
                }
            } else {
                if (isVisible) {
                    tracker.classList.remove('visible');
                    isVisible = false;
                }
                // Clear dataset if nothing focused
                delete hint.dataset.line;
            }
        }

        content.addEventListener('mousemove', (e) => {
            lastX = e.clientX;
            lastY = e.clientY;
            updateTracker(lastX, lastY, true);
        });

        content.addEventListener('mouseleave', () => {
            tracker.classList.remove('visible');
            isVisible = false;
        });

        // Update state on scroll but keep hidden until mouse moves
        // This ensures shortcuts (e/c) work after scroll even if visual is hidden
        content.addEventListener('scroll', () => {
            updateTracker(lastX, lastY, false);
        }, { passive: true });
    }

    let observer: MutationObserver | null = null;

    function init() {
        injectEditIcons();
        injectTaskInteractions();
        injectCommentInteractions();
        setupKeyboardShortcuts();
        setupLineTracker();

        if (!observer) {
            observer = new MutationObserver(() => {
                const tracker = document.querySelector('.glint-line-tracker') as HTMLElement;
                if (tracker) {
                    if (window.__glintEditingActive) {
                        tracker.style.display = 'none';
                    } else {
                        tracker.style.display = '';
                    }
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
        }


    }

    init();
    document.addEventListener('glint:navigated', init);
});

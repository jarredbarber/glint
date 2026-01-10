import { saveScrollPosition, suppressSSEReload } from './scroll-utils.js';

/**
 * ============================================================================
 * GLINT SCROLL PRESERVATION
 * ============================================================================
 * 
 * CRITICAL: Any code that triggers a file save (and thus SSE hot-reload)
 * MUST handle scroll preservation to avoid jumping to the top of the page.
 * 
 * PATTERN TO FOLLOW:
 * 1. Save scroll position before/after save:
 *    const contentEl = document.querySelector('.content');
 *    sessionStorage.setItem('glint-scroll-y', String(contentEl.scrollTop));
 * 
 * 2. Suppress SSE reload (if not doing a full refresh):
 *    sessionStorage.setItem('glint-suppress-reload', Date.now().toString());
 * 
 * Files using this pattern:
 *   - image-resize.ts (after resize save)
 *   - editor-integration.ts (after inline edit save)
 *   - This file (after image paste upload)
 * ============================================================================
 */

// Disable browser's automatic scroll restoration
if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
}

// Restore scroll position after full page load
window.addEventListener('load', () => {
    const savedScroll = sessionStorage.getItem('glint-scroll-y');
    if (savedScroll) {
        sessionStorage.removeItem('glint-scroll-y');
        const scrollY = parseInt(savedScroll);
        console.log('[Glint] Restoring scroll to:', scrollY);
        // Scroll the content container, not the window
        const contentEl = document.querySelector('.content') || document.querySelector('main');
        if (contentEl) {
            requestAnimationFrame(() => {
                contentEl.scrollTop = scrollY;
            });
        }
    }
});

document.addEventListener('DOMContentLoaded', () => {

    let lastHoveredElement: HTMLElement | null = null;
    let lastMouseY = 0;

    document.addEventListener('mouseover', (e) => {
        lastHoveredElement = e.target as HTMLElement;
    });

    document.addEventListener('mousemove', (e) => {
        lastMouseY = e.clientY;
    });

    document.addEventListener('paste', async (e: ClipboardEvent) => {
        const clipboardData = e.clipboardData;
        if (!clipboardData) return;

        const items = clipboardData.items;
        let blob: File | null = null;

        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') === 0) {
                blob = items[i].getAsFile();
                break;
            }
        }

        if (blob) {
            e.preventDefault();
            const result = findInsertionLine(lastHoveredElement, lastMouseY);
            await uploadImage(blob, result.line, result.debug);
        }
    });



    interface InsertionResult {
        line: number;
        debug: string;
    }

    function findInsertionLine(el: HTMLElement | null, mouseY: number): InsertionResult {
        const contentContainer = document.querySelector('.markdown-body') || document.querySelector('main.content');
        if (!contentContainer) return { line: -1, debug: 'No content container found' };

        // Get all elements with data-source-line
        const allWithLine = Array.from(contentContainer.querySelectorAll('[data-source-line]')) as HTMLElement[];
        if (allWithLine.length === 0) {
            return { line: -1, debug: 'No elements with data-source-line in document' };
        }

        let currentLine = -1;
        let detectionMethod = 'none';

        // Try to find ancestor with data-source-line
        if (el) {
            let current: HTMLElement | null = el;
            while (current && contentContainer.contains(current)) {
                if (current.hasAttribute('data-source-line')) {
                    currentLine = parseInt(current.getAttribute('data-source-line') || '-1');
                    detectionMethod = 'ancestor';
                    console.log(`[Glint] Found via ancestor: <${current.tagName}> line ${currentLine}`);
                    break;
                }
                current = current.parentElement;
            }
        }

        // Fallback: find nearest element by vertical position
        if (currentLine === -1) {
            let closestDist = Infinity;
            let closestLine = -1;
            let closestTag = '';

            for (const elem of allWithLine) {
                const rect = elem.getBoundingClientRect();
                const elemMidY = rect.top + rect.height / 2;
                const dist = Math.abs(mouseY - elemMidY);
                if (dist < closestDist) {
                    closestDist = dist;
                    closestLine = parseInt(elem.getAttribute('data-source-line') || '-1');
                    closestTag = elem.tagName;
                }
            }

            if (closestLine === -1) {
                return { line: -1, debug: 'Could not find nearest element' };
            }
            currentLine = closestLine;
            detectionMethod = `proximity (mouseY=${mouseY}, closest dist=${closestDist.toFixed(0)})`;
            console.log(`[Glint] Found via proximity: <${closestTag}> line ${currentLine}, mouseY=${mouseY}, dist=${closestDist.toFixed(0)}`);
        }

        // Check if we clicked the top or bottom half of the element
        let targetLine = -1;
        if (el && detectionMethod === 'ancestor') {
            let current: HTMLElement | null = el;
            while (current && !current.hasAttribute('data-source-line')) {
                current = current.parentElement;
            }
            if (current) {
                const rect = current.getBoundingClientRect();
                const relativeY = mouseY - rect.top;
                if (relativeY < rect.height / 2) {
                    targetLine = currentLine;
                    console.log(`[Glint] Top half click on line ${currentLine}, targeted same line`);
                }
            }
        }

        // Find the next element after currentLine
        let nextLine = Infinity;
        let nextTag = '';

        for (const elem of allWithLine) {
            const line = parseInt(elem.getAttribute('data-source-line') || '-1');
            if (line > currentLine && line < nextLine) {
                nextLine = line;
                nextTag = elem.tagName;
            }
        }

        if (targetLine === -1) {
            targetLine = nextLine;
        }

        if (targetLine === Infinity) {
            // Fallback: if we were at the last element, just use currentLine + 1
            targetLine = currentLine + 1;
        }

        return { line: targetLine, debug: `Hovered line ${currentLine}, target line ${targetLine} (next element was <${nextTag}> at ${nextLine})` };
    }

    async function uploadImage(blob: Blob, targetLine: number, debug: string) {
        // Save scroll position IMMEDIATELY before anything else
        saveScrollPosition();
        const contentEl = document.querySelector('.content') || document.querySelector('main');
        const scrollYBeforeUpload = contentEl ? contentEl.scrollTop : 0;

        console.log(`[Glint] Target line: ${targetLine}, Debug: ${debug}`);

        if (targetLine === -1) {
            alert(`Could not determine insertion point.\n\nDebug: ${debug}`);
            return;
        }

        const originalCursor = document.body.style.cursor;
        document.body.style.cursor = 'wait';

        try {
            const pathname = window.location.pathname;
            let path = pathname.substring(1) || 'README.md';

            const formData = new FormData();
            formData.append('file', blob, 'pasted-image.png');
            formData.append('articlePath', path);

            const upRes = await fetch('/api/upload', { method: 'POST', body: formData });
            if (!upRes.ok) {
                const err = await upRes.json();
                throw new Error(err.error || 'Upload failed');
            }
            const { url } = await upRes.json();

            const sourceRes = await fetch(`/api/source/${path}`);
            if (!sourceRes.ok) throw new Error('Failed to get source');
            const { content, hash } = await sourceRes.json();

            const lines = content.split('\n');
            const imageMarkdown = `![Image](${url})\n`;

            let newContent;
            if (targetLine > 0 && targetLine <= lines.length + 1) {
                // Insert at the line (if targetLine is 51, it goes at index 50)
                lines.splice(targetLine - 1, 0, imageMarkdown);
                newContent = lines.join('\n');
            } else {
                throw new Error('Invalid target line');
            }

            const saveRes = await fetch('/api/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path, content: newContent, hash })
            });
            if (!saveRes.ok) throw new Error('Failed to save content');

            // Refresh content without full reload to avoid scroll stutter
            const currentPath = window.location.pathname;

            // Set flag to suppress SSE hot-reload (since we're about to refresh content ourselves)
            suppressSSEReload();

            const refreshRes = await fetch(currentPath);
            if (refreshRes.ok) {
                const html = await refreshRes.text();
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');

                const freshContent = doc.querySelector('main.content');
                const currentContent = document.querySelector('main.content');

                console.log('[Glint] Before innerHTML replace, scroll saved as:', scrollYBeforeUpload);

                if (freshContent && currentContent) {
                    currentContent.innerHTML = freshContent.innerHTML;

                    console.log('[Glint] After innerHTML replace, about to restore scroll to:', scrollYBeforeUpload);

                    // Use double RAF to ensure layout is complete before setting scroll
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            const scrollableEl = document.querySelector('.content') as HTMLElement;
                            if (scrollableEl) {
                                console.log('[Glint] Current scrollTop before set:', scrollableEl.scrollTop);
                                scrollableEl.scrollTop = scrollYBeforeUpload;
                                console.log('[Glint] scrollTop after set:', scrollableEl.scrollTop);
                            }
                        });
                    });

                    // Re-initialize mermaid if present
                    const mermaid = (window as any).mermaid;
                    if (typeof mermaid !== 'undefined') {
                        mermaid.init(undefined, document.querySelectorAll('.mermaid'));
                    }

                    // Dispatch event for other scripts
                    document.dispatchEvent(new CustomEvent('glint:navigated'));
                }
            }
        } catch (err: any) {
            console.error(err);
            alert(`Error uploading image: ${err.message}`);
        } finally {
            document.body.style.cursor = originalCursor;
        }
    }
});

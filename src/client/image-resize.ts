
import { saveScrollPosition, suppressSSEReload } from './scroll-utils.js';

document.addEventListener('DOMContentLoaded', () => {
    let activeImage: HTMLImageElement | null = null;
    let handle: HTMLDivElement | null = null;
    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    function createHandle(img: HTMLImageElement) {
        if (handle) handle.remove();

        handle = document.createElement('div');
        handle.className = 'glint-resize-handle';
        Object.assign(handle.style, {
            position: 'absolute',
            width: '12px',
            height: '12px',
            backgroundColor: 'var(--aqua, #7fbbb3)',
            border: '2px solid var(--bg-color, #2d353b)',
            borderRadius: '50%',
            cursor: 'nwse-resize',
            zIndex: '1000',
            bottom: '-6px',
            right: '-6px'
        });

        // We need a wrapper to position the handle relative to the image
        // but adding a wrapper might break some CSS. 
        // Better: position it absolutely based on image position.
        updateHandlePosition(img);

        handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            isResizing = true;
            activeImage = img;
            startX = e.clientX;
            startWidth = img.clientWidth;
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });

        document.body.appendChild(handle);
    }

    function updateHandlePosition(img: HTMLImageElement) {
        if (!handle) return;
        const rect = img.getBoundingClientRect();
        const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

        handle.style.left = `${rect.right + scrollLeft - 6}px`;
        handle.style.top = `${rect.bottom + scrollTop - 6}px`;
    }

    function onMouseMove(e: MouseEvent) {
        if (!isResizing || !activeImage) return;

        const deltaX = e.clientX - startX;
        const newWidth = Math.max(50, startWidth + deltaX);

        // Use percentage if possible or just pixels? 
        // For markdown, width="500" or width="50%" are both common in HTML tags.
        // Let's stick to pixel width for simplicity in regex matching.
        activeImage.style.width = `${newWidth}px`;
        activeImage.style.height = 'auto'; // Maintain aspect ratio
        updateHandlePosition(activeImage);
    }

    function getSourceLine(img: HTMLElement): number {
        let current: HTMLElement | null = img;
        while (current && current.tagName !== 'BODY') {
            const line = current.getAttribute('data-source-line');
            if (line) return parseInt(line);
            current = current.parentElement;
        }
        return -1;
    }

    async function onMouseUp() {
        if (!isResizing || !activeImage) return;
        isResizing = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);

        const img = activeImage;
        const finalWidth = img.clientWidth;
        const sourceLine = getSourceLine(img);

        if (sourceLine !== -1) {
            await syncResizeToSource(img, sourceLine, finalWidth);
        }
    }

    async function syncResizeToSource(img: HTMLImageElement, lineNum: number, width: number) {
        try {
            const pathname = window.location.pathname;
            const path = pathname.substring(1) || 'README.md';

            const res = await fetch(`/api/source/${path}`);
            if (!res.ok) throw new Error('Failed to get source');
            const { content, hash } = await res.json();

            const lines = content.split('\n');
            if (lineNum <= 0 || lineNum > lines.length) return;

            let line = lines[lineNum - 1];
            // Use data-glint-src if available (the original markdown path), fallback to src
            const srcAttr = img.getAttribute('data-glint-src') || img.getAttribute('src');
            if (!srcAttr) return;

            // Simple regex to find the image on this line. 
            // It could be ![alt](url) or <img src="url" ...>

            // 1. Try to find/update existing img tag (legacy support)
            if (line.includes('<img') && line.includes(srcAttr)) {
                if (line.includes('width=')) {
                    line = line.replace(/width=["'][^"']*["']/, `width="${width}"`);
                } else {
                    line = line.replace('<img', `<img width="${width}"`);
                }
            }
            // 2. Update existing ![alt|width](url) syntax
            else if (line.match(/!\[.*\|.*\]\(.*\)/) && line.includes(srcAttr)) {
                // Replace the existing width: ![alt|oldwidth](url) → ![alt|newwidth](url)
                line = line.replace(/!\[([^\]|]*)\|[^\]]*\]\(/, `![$1|${width}](`);
            }
            // 3. Add width to plain markdown image: ![alt](url) → ![alt|width](url)
            else if (line.match(/!\[.*\]\(.*\)/) && line.includes(srcAttr)) {
                // Insert |width before the closing bracket
                line = line.replace(/!\[([^\]]*)\]\(/, `![$1|${width}](`);
            }

            lines[lineNum - 1] = line;
            const newContent = lines.join('\n');

            const saveRes = await fetch('/api/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path, content: newContent, hash })
            });

            if (!saveRes.ok) throw new Error('Failed to save resize');

            // Suppress SSE hot-reload and save scroll position for restoration
            // The file save triggers an SSE event; we want to preserve scroll
            saveScrollPosition();
            suppressSSEReload();

            console.log(`[Glint] Image on line ${lineNum} resized to ${width}px and saved.`);

        } catch (err) {
            console.error('[Glint] Resize sync error:', err);
        }
    }

    document.addEventListener('mouseover', (e) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'IMG' && !isResizing) {
            createHandle(target as HTMLImageElement);
        }
    });

    // Clean up handle when mouse leaves image area (with some buffer)
    document.addEventListener('mousemove', (e) => {
        // If we identify that we are no longer interacting with the image/handle, clean up
        if (isResizing || !handle || !activeImage) return;

        const imgRect = activeImage.getBoundingClientRect();
        const buffer = 20;
        const isFar = e.clientX < imgRect.left - buffer ||
            e.clientX > imgRect.right + buffer ||
            e.clientY < imgRect.top - buffer ||
            e.clientY > imgRect.bottom + buffer;

        if (isFar) {
            handle.remove();
            handle = null;
            activeImage = null;
        }
    });

    // Update handle position on scroll/resize
    window.addEventListener('resize', () => { if (activeImage) updateHandlePosition(activeImage); });
    const contentArea = document.querySelector('.content');
    if (contentArea) {
        contentArea.addEventListener('scroll', () => { if (activeImage) updateHandlePosition(activeImage); });
    }
});

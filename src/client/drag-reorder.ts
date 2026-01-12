/**
 * Drag-to-reorder functionality for markdown sections.
 * Allows users to drag headings (H2-H6) to reorder content.
 */
import { saveScrollPosition, suppressSSEReload } from './scroll-utils.js';

declare global {
    interface Window {
        __glintDragging?: DragState | null;
        __glintEditingActive?: boolean;
    }
}

interface DragState {
    element: HTMLElement;
    fromStart: number;
    fromEnd: number;
    level: number;
}

interface DropZone {
    element: HTMLElement;
    insertBeforeLine: number;
}

let dropZones: DropZone[] = [];

export function initDragReorder() {
    if (window.__glintEditingActive) return;

    const contentWrapper = document.querySelector('.content-wrapper');
    if (!contentWrapper) return;

    const headings = contentWrapper.querySelectorAll('h2, h3, h4, h5, h6');

    headings.forEach(heading => {
        const h = heading as HTMLElement;
        const sourceLine = h.getAttribute('data-source-line');
        if (!sourceLine) return;

        makeSectionDraggable(h);
    });
}

function makeSectionDraggable(heading: HTMLElement) {
    if (heading.hasAttribute('draggable')) return;

    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.innerHTML = '⋮⋮';
    handle.title = 'Drag to reorder section';
    heading.prepend(handle);

    heading.setAttribute('draggable', 'true');
    heading.classList.add('draggable-section');

    heading.addEventListener('dragstart', handleDragStart);
    heading.addEventListener('dragend', handleDragEnd);

    const editIcon = heading.querySelector('.heading-edit-icon');
    if (editIcon) {
        editIcon.addEventListener('mousedown', (e) => {
            e.stopPropagation();
        });
    }
}

function handleDragStart(e: DragEvent) {
    const heading = e.currentTarget as HTMLElement;
    const sourceLine = parseInt(heading.getAttribute('data-source-line') || '0');
    if (!sourceLine) return;

    const { start, end } = findSectionBoundary(heading);
    const level = parseInt(heading.tagName.substring(1));

    window.__glintDragging = {
        element: heading,
        fromStart: start,
        fromEnd: end,
        level: level
    };

    heading.classList.add('is-dragging');

    setTimeout(() => {
        if (window.__glintDragging) {
            showDropZones();
        }
    }, 100);

    if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', heading.textContent || '');
    }
}

function handleDragEnd(e: DragEvent) {
    const heading = e.currentTarget as HTMLElement;
    heading.classList.remove('is-dragging');

    hideDropZones();
    window.__glintDragging = null;
}

function findSectionBoundary(heading: HTMLElement): { start: number; end: number } {
    const startLine = parseInt(heading.getAttribute('data-source-line') || '0');
    const headingLevel = parseInt(heading.tagName.substring(1));

    const contentWrapper = heading.closest('.content-wrapper');
    if (!contentWrapper) return { start: startLine, end: startLine };

    const allElements = Array.from(contentWrapper.querySelectorAll('[data-source-line]')) as HTMLElement[];
    const headingIndex = allElements.indexOf(heading);

    let endLine = -1;
    for (let i = headingIndex + 1; i < allElements.length; i++) {
        const el = allElements[i];
        if (el.tagName.match(/^H[1-6]$/)) {
            const nextLevel = parseInt(el.tagName.substring(1));
            if (nextLevel <= headingLevel) {
                endLine = parseInt(el.getAttribute('data-source-line') || '0');
                break;
            }
        }
    }

    if (endLine === -1) {
        const lastElement = allElements[allElements.length - 1];
        endLine = parseInt(lastElement.getAttribute('data-source-line') || String(startLine + 1));
        endLine += 1;
    }

    return { start: startLine, end: endLine };
}

function showDropZones() {
    if (!window.__glintDragging) return;

    const contentWrapper = document.querySelector('.content-wrapper');
    if (!contentWrapper) return;

    const dragState = window.__glintDragging;

    const allElements = Array.from(contentWrapper.querySelectorAll('[data-source-line]')) as HTMLElement[];

    allElements.forEach((el) => {
        const elLine = parseInt(el.getAttribute('data-source-line') || '0');
        if (elLine >= dragState.fromStart && elLine < dragState.fromEnd) {
            return;
        }

        const dropZone = document.createElement('div');
        dropZone.className = 'drop-zone';
        dropZone.setAttribute('data-insert-before', String(elLine));

        el.parentNode?.insertBefore(dropZone, el);

        dropZone.addEventListener('dragover', handleDragOver);
        dropZone.addEventListener('dragleave', handleDragLeave);
        dropZone.addEventListener('drop', handleDrop);

        dropZones.push({
            element: dropZone,
            insertBeforeLine: elLine
        });
    });

    const lastElement = allElements[allElements.length - 1];
    if (lastElement) {
        const dropZone = document.createElement('div');
        dropZone.className = 'drop-zone';
        dropZone.setAttribute('data-insert-before', 'end');

        lastElement.parentNode?.insertBefore(dropZone, lastElement.nextSibling);

        dropZone.addEventListener('dragover', handleDragOver);
        dropZone.addEventListener('dragleave', handleDragLeave);
        dropZone.addEventListener('drop', handleDrop);

        const lastLine = parseInt(lastElement.getAttribute('data-source-line') || '0');
        dropZones.push({
            element: dropZone,
            insertBeforeLine: lastLine + 1000
        });
    }
}

function hideDropZones() {
    dropZones.forEach(dz => dz.element.remove());
    dropZones = [];
}

function handleDragOver(e: DragEvent) {
    e.preventDefault();
    const dropZone = e.currentTarget as HTMLElement;
    dropZone.classList.add('drop-zone-active');

    if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'move';
    }
}

function handleDragLeave(e: DragEvent) {
    const dropZone = e.currentTarget as HTMLElement;
    dropZone.classList.remove('drop-zone-active');
}

async function handleDrop(e: DragEvent) {
    e.preventDefault();
    const dropZone = e.currentTarget as HTMLElement;
    dropZone.classList.remove('drop-zone-active');

    if (!window.__glintDragging) return;

    const dragState = window.__glintDragging;
    const insertBeforeAttr = dropZone.getAttribute('data-insert-before');

    let insertBeforeLine: number;
    if (insertBeforeAttr === 'end') {
        insertBeforeLine = 999999;
    } else {
        insertBeforeLine = parseInt(insertBeforeAttr || '0');
    }

    if (insertBeforeLine === dragState.fromStart) {
        return;
    }

    await performReorder(dragState.fromStart, dragState.fromEnd, insertBeforeLine);
}

async function performReorder(fromStart: number, fromEnd: number, insertBefore: number) {
    const path = window.location.pathname.substring(1) || 'README.md';

    try {
        document.body.style.cursor = 'wait';

        const sourceRes = await fetch(`/api/source/${path}`);
        if (!sourceRes.ok) {
            throw new Error('Failed to load source');
        }
        const { hash } = await sourceRes.json();

        const reorderRes = await fetch('/api/reorder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                path,
                fromLine: fromStart,
                toLine: fromEnd,
                insertBeforeLine: insertBefore,
                hash
            })
        });

        if (!reorderRes.ok) {
            const errorData = await reorderRes.json();
            throw new Error(errorData.error || 'Reorder failed');
        }

        saveScrollPosition();
        suppressSSEReload();
        window.location.reload();

    } catch (err: any) {
        console.error('Reorder error:', err);
        alert(`Failed to reorder: ${err.message}`);
        document.body.style.cursor = '';
    }
}

(window as any).initDragReorder = initDragReorder;

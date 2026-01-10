/**
 * Client-side integration for the Glint Editor.
 * This script handles section extraction, icon injection, and modal management.
 */

interface EditorOverlayOptions {
    initialValue: string;
    vimMode: boolean;
    onSave: (content: string) => void;
    onCancel: () => void;
}

declare const GlintEditor: any;

document.addEventListener('DOMContentLoaded', () => {
    let activeEditor: any = null;
    let activeOverlay: HTMLElement | null = null;

    // 1. Inject Edit Icons into Headings
    function injectEditIcons() {
        const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
        headings.forEach(h => {
            const heading = h as HTMLElement;
            // Skip if already has an icon
            if (heading.querySelector('.heading-edit-icon')) return;

            // Get the source line if available
            const sourceLine = heading.getAttribute('data-source-line');
            if (sourceLine === null) return;

            const icon = document.createElement('span');
            icon.className = 'heading-edit-icon';
            icon.innerHTML = '✏️';
            icon.title = 'Edit this section';

            icon.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                openSectionEditor(heading, parseInt(sourceLine));
            };

            heading.appendChild(icon);
        });
    }

    // 2. Open Editor for a specific section
    async function openSectionEditor(heading: HTMLElement, startLine: number) {
        console.log(`Opening editor for section starting at line ${startLine}`);

        // Find end line (next heading of same or higher level)
        const allHeadings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
        const currentIndex = allHeadings.indexOf(heading);
        let endLineIndex = -1; // -1 means end of file

        for (let i = currentIndex + 1; i < allHeadings.length; i++) {
            const nextHeading = allHeadings[i] as HTMLElement;
            const nextLevel = parseInt(nextHeading.tagName.substring(1));
            const currentLevel = parseInt(heading.tagName.substring(1));

            if (nextLevel <= currentLevel) {
                const endLineAttr = nextHeading.getAttribute('data-source-line');
                if (endLineAttr) {
                    endLineIndex = parseInt(endLineAttr);
                }
                break;
            }
        }

        const path = window.location.pathname.substring(1) || 'README.md'; // Fallback for root

        try {
            document.body.style.cursor = 'wait';
            const res = await fetch(`/api/source/${path}`);
            if (!res.ok) throw new Error('Failed to load source');
            const { content, hash } = await res.json();

            // Extract section
            const lines = content.split('\n');
            // endLineIndex is 1-based line number of next heading. 
            // We want everything up to (but not including) that line.
            const sectionLines = lines.slice(startLine - 1, endLineIndex === -1 ? undefined : endLineIndex - 1);
            const sectionContent = sectionLines.join('\n');

            createEditorOverlay(heading.innerText.replace('✏️', '').trim(), sectionContent, async (newSectionContent: string) => {
                // Splicing logic
                const newLines = [...lines];
                const deleteCount = endLineIndex === -1 ? lines.length - startLine + 1 : endLineIndex - startLine;
                newLines.splice(startLine - 1, deleteCount, newSectionContent);
                const newFullContent = newLines.join('\n');

                try {
                    const saveRes = await fetch('/api/save', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path, content: newFullContent, hash })
                    });

                    if (!saveRes.ok) {
                        const err = await saveRes.json();
                        throw new Error(err.error || 'Save failed');
                    }

                    closeEditorOverlay();
                    window.location.reload(); // Refresh to see changes
                } catch (err: any) {
                    alert(`Error saving: ${err.message}`);
                }
            });

        } catch (err: any) {
            console.error(err);
            alert(`Error loading section source: ${err.message}`);
        } finally {
            document.body.style.cursor = '';
        }
    }

    function createEditorOverlay(title: string, initialValue: string, onSave: (content: string) => void) {
        activeOverlay = document.createElement('div');
        activeOverlay.className = 'glint-editor-overlay';

        const modal = document.createElement('div');
        modal.className = 'glint-editor-modal';

        const header = document.createElement('div');
        header.className = 'glint-editor-modal-header';
        header.innerHTML = `
            <div class="glint-editor-modal-title">Editing: ${title}</div>
            <div class="glint-editor-modal-close">×</div>
        `;

        const closeBtn = header.querySelector('.glint-editor-modal-close') as HTMLElement;
        closeBtn.onclick = closeEditorOverlay;

        const body = document.createElement('div');
        body.className = 'glint-editor-modal-body';

        modal.appendChild(header);
        modal.appendChild(body);
        activeOverlay.appendChild(modal);
        document.body.appendChild(activeOverlay);

        // Initialize GlintEditor (which is globally available from editor.bundle.js)
        if (typeof GlintEditor !== 'undefined') {
            activeEditor = new GlintEditor(body, {
                initialValue: initialValue,
                vimMode: true, // Default to true as requested!
                onSave: onSave,
                onCancel: closeEditorOverlay
            });
        } else {
            console.error('GlintEditor not found. Make sure editor.bundle.js is loaded.');
            alert('Editor failed to load. Please refresh the page.');
        }

        // Close on background click
        activeOverlay.onclick = (e) => {
            if (e.target === activeOverlay) closeEditorOverlay();
        };

        // Prevent body scroll
        document.body.style.overflow = 'hidden';
    }

    function closeEditorOverlay() {
        if (activeEditor) {
            activeEditor.destroy();
            activeEditor = null;
        }
        if (activeOverlay) {
            activeOverlay.remove();
            activeOverlay = null;
        }
        document.body.style.overflow = '';
    }

    // Run on load
    injectEditIcons();

    // Re-run on client-side navigation
    document.addEventListener('glint:navigated', injectEditIcons);
});

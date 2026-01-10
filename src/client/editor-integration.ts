import { saveScrollPosition, suppressSSEReload } from './scroll-utils.js';

interface EditorOptions {
    initialValue: string;
    vimMode: boolean;
    onSave: (content: string) => void;
    onCancel: () => void;
}

declare const GlintEditor: any;

document.addEventListener('DOMContentLoaded', () => {
    let activeEditor: any = null;
    let activeEditorContainer: HTMLElement | null = null;
    let hiddenElements: HTMLElement[] = [];

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
            icon.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                openInlineEditor(heading, parseInt(sourceLine));
            };

            heading.prepend(icon);
        });

        // Add preamble edit icon to article header
        injectPreambleEditIcon();
    }

    // 1b. Inject edit icon for the preamble (content before first heading)
    function injectPreambleEditIcon() {
        const articleHeader = document.querySelector('.article-header');
        if (!articleHeader || articleHeader.querySelector('.preamble-edit-icon')) return;

        const icon = document.createElement('span');
        icon.className = 'heading-edit-icon preamble-edit-icon';
        icon.innerHTML = '✏️';
        icon.title = 'Edit document header';
        icon.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            openPreambleEditor();
        };

        const h1 = articleHeader.querySelector('h1');
        if (h1) h1.prepend(icon);
    }

    // Open editor for preamble (line 1 to first content heading)
    async function openPreambleEditor() {
        if (activeEditor) {
            if (!confirm('You have an active editor open. Discard changes?')) return;
            closeInlineEditor();
        }

        const path = window.location.pathname.substring(1) || 'README.md';

        try {
            const res = await fetch(`/api/source/${path}`);
            if (!res.ok) throw new Error('Failed to load source');
            const { content, hash } = await res.json();

            const lines = content.split('\n');

            // Find first heading in rendered content (respects frontmatter title stripping)
            const firstRenderedHeading = document.querySelector('.content-wrapper h1, .content-wrapper h2, .content-wrapper h3, .content-wrapper h4, .content-wrapper h5, .content-wrapper h6');
            let endLine = lines.length + 1; // Default: whole file

            if (firstRenderedHeading) {
                const lineAttr = firstRenderedHeading.getAttribute('data-source-line');
                if (lineAttr) endLine = parseInt(lineAttr);
            }

            const preambleContent = lines.slice(0, endLine - 1).join('\n');

            // Find elements to hide (everything before first content heading)
            const contentWrapper = document.querySelector('.content-wrapper');
            if (!contentWrapper) return;

            const allElements = Array.from(contentWrapper.querySelectorAll('[data-source-line]')) as HTMLElement[];
            const sectionElements: HTMLElement[] = [];
            for (const el of allElements) {
                const line = parseInt(el.getAttribute('data-source-line') || '-1');
                if (line > 0 && line < endLine) {
                    sectionElements.push(el);
                }
            }

            // Also hide article-header meta elements if they exist
            const articleHeader = document.querySelector('.article-header') as HTMLElement;

            hiddenElements = sectionElements;
            activeEditorContainer = document.createElement('div');
            activeEditorContainer.className = 'glint-inline-editor-container';

            // Insert at the top of content-wrapper
            const firstChild = contentWrapper.firstElementChild;
            if (firstChild) {
                contentWrapper.insertBefore(activeEditorContainer, firstChild);
            } else {
                contentWrapper.appendChild(activeEditorContainer);
            }

            hiddenElements.forEach(el => el.style.display = 'none');
            if (articleHeader) articleHeader.style.display = 'none';

            if (typeof GlintEditor !== 'undefined') {
                activeEditor = new GlintEditor(activeEditorContainer, {
                    initialValue: preambleContent,
                    vimMode: true,
                    onSave: async (newContent: string) => {
                        const newLines = [...lines];
                        newLines.splice(0, endLine - 1, newContent);
                        const newFullContent = newLines.join('\n');

                        try {
                            const saveRes = await fetch('/api/save', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ path, content: newFullContent, hash })
                            });
                            if (!saveRes.ok) throw new Error((await saveRes.json()).error || 'Save failed');

                            saveScrollPosition();
                            suppressSSEReload();
                            window.location.reload();
                        } catch (err: any) {
                            alert(`Error saving: ${err.message}`);
                        }
                    },
                    onCancel: () => {
                        closeInlineEditor();
                        if (articleHeader) articleHeader.style.display = '';
                    }
                });
            }
        } catch (err: any) {
            console.error(err);
            alert(`Error: ${err.message}`);
        }
    }

    // 2. Open Inline Editor for a specific section
    async function openInlineEditor(heading: HTMLElement, startLine: number) {
        if (activeEditor) {
            if (!confirm('You have an active editor open. Discard changes?')) return;
            closeInlineEditor();
        }

        console.log(`Opening inline editor for section starting at line ${startLine}`);

        const headingLevel = parseInt(heading.tagName.substring(1));

        // Find end line by looking for the next heading of same or higher level
        let endLineIndex = -1;
        const allHeadings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')) as HTMLElement[];
        const headingIndex = allHeadings.indexOf(heading);
        for (let i = headingIndex + 1; i < allHeadings.length; i++) {
            const nextLevel = parseInt(allHeadings[i].tagName.substring(1));
            if (nextLevel <= headingLevel) {
                const endAttr = allHeadings[i].getAttribute('data-source-line');
                if (endAttr) endLineIndex = parseInt(endAttr);
                break;
            }
        }

        // Identify section elements by source line (not just DOM order)
        const contentWrapper = heading.closest('.content-wrapper') || document.body;
        const allElements = Array.from(contentWrapper.querySelectorAll('[data-source-line]')) as HTMLElement[];
        const sectionElements: HTMLElement[] = [];

        for (const el of allElements) {
            const lineAttr = el.getAttribute('data-source-line');
            if (!lineAttr) continue;
            const line = parseInt(lineAttr);
            // Include if line >= startLine AND (no endLine OR line < endLine)
            if (line >= startLine && (endLineIndex === -1 || line < endLineIndex)) {
                sectionElements.push(el);
            }
        }

        const path = window.location.pathname.substring(1) || 'README.md';

        try {
            heading.style.cursor = 'wait';
            const res = await fetch(`/api/source/${path}`);
            if (!res.ok) throw new Error('Failed to load source');
            const { content, hash } = await res.json();

            const lines = content.split('\n');
            const sectionLines = lines.slice(startLine - 1, endLineIndex === -1 ? undefined : endLineIndex - 1);
            const sectionContent = sectionLines.join('\n');

            // Swap DOM
            hiddenElements = sectionElements;
            activeEditorContainer = document.createElement('div');
            activeEditorContainer.className = 'glint-inline-editor-container';

            // Insert container before the first element of the section
            heading.parentNode?.insertBefore(activeEditorContainer, heading);

            // Hide section elements
            hiddenElements.forEach(el => el.style.display = 'none');

            // Initialize Editor
            if (typeof GlintEditor !== 'undefined') {
                activeEditor = new GlintEditor(activeEditorContainer, {
                    initialValue: sectionContent,
                    vimMode: true,
                    onSave: async (newSectionContent: string) => {
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

                            if (!saveRes.ok) throw new Error((await saveRes.json()).error || 'Save failed');

                            // Save scroll position before reload
                            // Save scroll position before reload
                            saveScrollPosition();
                            suppressSSEReload();
                            window.location.reload();
                        } catch (err: any) {
                            alert(`Error saving: ${err.message}`);
                        }
                    },
                    onCancel: closeInlineEditor
                });
            } else {
                alert('Editor failed to load.');
                closeInlineEditor();
            }

        } catch (err: any) {
            console.error(err);
            alert(`Error: ${err.message}`);
        } finally {
            heading.style.cursor = '';
        }
    }

    function closeInlineEditor() {
        if (activeEditor) {
            activeEditor.destroy();
            activeEditor = null;
        }
        if (activeEditorContainer) {
            activeEditorContainer.remove();
            activeEditorContainer = null;
        }
        hiddenElements.forEach(el => el.style.display = '');
        hiddenElements = [];
    }

    injectEditIcons();
    document.addEventListener('glint:navigated', injectEditIcons);
});

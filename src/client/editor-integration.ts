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
            icon.title = 'Edit this section';

            icon.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                openInlineEditor(heading, parseInt(sourceLine));
            };

            heading.appendChild(icon);
        });
    }

    // 2. Open Inline Editor for a specific section
    async function openInlineEditor(heading: HTMLElement, startLine: number) {
        if (activeEditor) {
            if (!confirm('You have an active editor open. Discard changes?')) return;
            closeInlineEditor();
        }

        console.log(`Opening inline editor for section starting at line ${startLine}`);

        // Identify section elements
        const sectionElements: HTMLElement[] = [heading];
        const headingLevel = parseInt(heading.tagName.substring(1));

        let next = heading.nextElementSibling;
        while (next) {
            const nextTagName = next.tagName;
            if (/^H[1-6]$/.test(nextTagName)) {
                const nextLevel = parseInt(nextTagName.substring(1));
                if (nextLevel <= headingLevel) break;
            }
            sectionElements.push(next as HTMLElement);
            next = next.nextElementSibling;
        }

        // Find end line
        let endLineIndex = -1;
        if (next) {
            const endLineAttr = next.getAttribute('data-source-line');
            if (endLineAttr) endLineIndex = parseInt(endLineAttr);
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
                            const contentEl = document.querySelector('.content') || document.querySelector('main');
                            if (contentEl) {
                                sessionStorage.setItem('glint-scroll-y', String(contentEl.scrollTop));
                            }
                            sessionStorage.setItem('glint-suppress-reload', Date.now().toString());
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

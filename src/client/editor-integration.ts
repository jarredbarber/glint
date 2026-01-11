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

        // Add code block edit icons
        injectCodeBlockEditIcons();
    }

    // 1c. Inject edit icons for code blocks
    function injectCodeBlockEditIcons() {
        const codeBlocks = document.querySelectorAll('pre');
        codeBlocks.forEach(pre => {
            if (pre.parentElement?.classList.contains('code-block-wrapper')) return;

            // Must have data-source-line
            const sourceLine = pre.getAttribute('data-source-line');
            if (sourceLine === null) return;

            // Try to find language class on the inner code element
            const code = pre.querySelector('code');
            let language = 'text';
            if (code && code.className) {
                const match = code.className.match(/language-(\w+)/);
                if (match) {
                    language = match[1];
                }
            }

            // Wrap pre in a wrapper for positioning the icon in the margin
            const wrapper = document.createElement('div');
            wrapper.className = 'code-block-wrapper';
            pre.parentNode?.insertBefore(wrapper, pre);
            wrapper.appendChild(pre);

            const icon = document.createElement('span');
            icon.className = 'code-edit-icon';
            icon.innerHTML = '✏️';
            icon.title = 'Edit code block';
            icon.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                openCodeBlockEditor(pre, parseInt(sourceLine), language);
            };

            wrapper.prepend(icon);
        });
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

    async function openCodeBlockEditor(pre: HTMLElement, startLine: number, language: string) {
        if (activeEditor) {
            if (!confirm('You have an active editor open. Discard changes?')) return;
            closeInlineEditor();
        }

        const path = window.location.pathname.substring(1) || 'README.md';

        try {
            pre.style.cursor = 'wait';
            const res = await fetch(`/api/source/${path}`);
            if (!res.ok) throw new Error('Failed to load source');
            const { content, hash } = await res.json();

            const lines = content.split('\n');

            // Code block logic:
            // startLine points to the ``` line OR the first content line depending on mapping?
            // Usually, mapped line is the OPENING fence.

            // We need to find the closing fence ``` to determine endLine.
            // Simplified: scan forward from startLine until we find ```
            let endLineIndex = -1;

            // Safety check: is startLine actually the fence?
            if (!lines[startLine - 1].trim().startsWith('```')) {
                console.warn('Mapped line is not a code fence, adjusting...');
                // It might be mapped to the content inside. Backtrack?
                // For now assume rehype-source-lines points to the element itself which corresponds to the fence.
            }

            for (let i = startLine; i < lines.length; i++) {
                if (lines[i].trim().startsWith('```')) {
                    endLineIndex = i + 1; // 1-indexed end line (inclusive of fence)
                    break;
                }
            }

            if (endLineIndex === -1) {
                throw new Error('Could not find closing code fence.');
            }

            // Extract content INCLUDING fences
            const sectionLines = lines.slice(startLine - 1, endLineIndex);
            const sectionContent = sectionLines.join('\n');

            // For the editor, maybe we want just the *inner* content?
            // Requested feature: "editing a python block runs the editor in python mode"
            // If we edit proper, we should edit the INNER content and strip fences for the editor,
            // then adding them back on save.

            const innerLines = lines.slice(startLine, endLineIndex - 1); // Exclude fences
            const innerContent = innerLines.join('\n');

            // Swap DOM
            hiddenElements = [pre];
            activeEditorContainer = document.createElement('div');
            activeEditorContainer.className = 'glint-inline-editor-container';

            pre.parentNode?.insertBefore(activeEditorContainer, pre);
            pre.style.display = 'none';

            if (typeof GlintEditor !== 'undefined') {
                activeEditor = new GlintEditor(activeEditorContainer, {
                    initialValue: innerContent,
                    vimMode: true,
                    language: language, // Pass the detected language
                    onSave: async (editedInnerContent: string) => {
                        // Reconstruct full block
                        const fenceStart = lines[startLine - 1]; // e.g. ```python
                        const fenceEnd = lines[endLineIndex - 1]; // e.g. ```

                        // New block content with fences
                        const newBlock = `${fenceStart}\n${editedInnerContent}\n${fenceEnd}`;

                        const newLines = [...lines];
                        // Replace original range [startLine, endLineIndex]
                        const deleteCount = endLineIndex - startLine + 1;
                        newLines.splice(startLine - 1, deleteCount, newBlock);

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
                    onCancel: closeInlineEditor
                });
            }

        } catch (err: any) {
            console.error(err);
            alert(`Error: ${err.message}`);
        } finally {
            pre.style.cursor = '';
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

    function injectTaskInteractions() {
        const checks = document.querySelectorAll('.glint-task-check');
        checks.forEach(check => {
            const el = check as HTMLElement;
            if (el.dataset.initialized) return;
            el.dataset.initialized = 'true';

            el.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();

                // Close any existing picker
                const existing = document.querySelector('.glint-state-picker');
                if (existing) {
                    existing.parentElement?.closest('.glint-task')?.classList.remove('picker-open');
                    existing.remove();
                }

                const taskNode = el.closest('.glint-task') as HTMLElement;
                if (!taskNode) return;

                const picker = document.createElement('div');
                picker.className = 'glint-state-picker';
                taskNode.classList.add('picker-open');

                const states = [
                    { icon: '🟦', marker: '[ ]', label: 'Open' },
                    { icon: '✅', marker: '[x]', label: 'Done' },
                    { icon: '🏃', marker: '[/]', label: 'Progress' },
                    { icon: '⌛', marker: '[w]', label: 'Waiting' },
                    { icon: '⛔', marker: '[b]', label: 'Blocked' }
                ];

                states.forEach(s => {
                    const opt = document.createElement('span');
                    opt.className = 'glint-state-option';
                    opt.innerHTML = s.icon;
                    opt.title = s.label;
                    opt.onclick = async (ev) => {
                        ev.stopPropagation();
                        picker.remove();
                        await updateTaskState(taskNode, s.marker);
                    };
                    picker.appendChild(opt);
                });

                el.appendChild(picker);

                // Close on click outside
                const closeHandler = () => {
                    taskNode.classList.remove('picker-open');
                    picker.remove();
                    document.removeEventListener('click', closeHandler);
                };
                setTimeout(() => document.addEventListener('click', closeHandler), 0);
            };
        });
    }

    async function updateTaskState(taskNode: HTMLElement, newMarker: string) {
        const sourceLine = taskNode.getAttribute('data-source-line');
        if (!sourceLine) return;

        const path = window.location.pathname.substring(1) || 'README.md';
        const lineNum = parseInt(sourceLine);

        try {
            taskNode.style.cursor = 'wait';
            const res = await fetch(`/api/source/${path}`);
            if (!res.ok) throw new Error('Failed to load source');
            const { content, hash } = await res.json();

            const lines = content.split('\n');
            const lineContent = lines[lineNum - 1];

            // Replace any state marker [ ] , [x] , [/] , [w] , [b]
            const newLineContent = lineContent.replace(/^(\s*-?\s*)\[[ x/wb]\]/i, `$1${newMarker}`);

            if (newLineContent === lineContent) return;

            lines[lineNum - 1] = newLineContent;
            const newFullContent = lines.join('\n');

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
            alert(`Error updating task: ${err.message}`);
        } finally {
            taskNode.style.cursor = '';
        }
    }

    function init() {
        injectEditIcons();
        injectTaskInteractions();
    }

    init();
    document.addEventListener('glint:navigated', init);
});

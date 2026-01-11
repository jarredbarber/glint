import { saveScrollPosition, suppressSSEReload } from './scroll-utils.js';

// Extend Window interface for global editing state
declare global {
    interface Window {
        __glintEditingActive?: boolean;
        __glintPendingReload?: boolean;
    }
}

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

            // Mark that editing is active (suppress SSE reloads)
            window.__glintEditingActive = true;

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

        // Clear editing flag
        window.__glintEditingActive = false;

        // If there's a pending reload from SSE, trigger it now
        if (window.__glintPendingReload) {
            window.__glintPendingReload = false;
            window.location.reload();
        }
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
            // 1. Update marker
            let newLineContent = lineContent.replace(/^(\s*-?\s*)\[[ x/wb]\]/i, `$1${newMarker}`);

            // 2. Manage completed date
            // Parse existing metadata block if present: (key:val ...) at end of line
            const metaRegex = /\s*\(([^)]+)\)$/;
            const hasMeta = metaRegex.exec(newLineContent);
            const today = new Date().toISOString().split('T')[0];

            if (newMarker === '[x]') {
                // Adding completed date
                if (hasMeta) {
                    // Check if already has completed date
                    if (!hasMeta[1].match(/(?:completed|done):/)) {
                        const newMeta = `${hasMeta[1]} completed:${today}`;
                        newLineContent = newLineContent.replace(metaRegex, ` (${newMeta})`);
                    }
                } else {
                    // No meta, append it
                    newLineContent = `${newLineContent} (completed:${today})`;
                }
            } else {
                // Removing completed date if present (unchecking)
                if (hasMeta) {
                    let inner = hasMeta[1];
                    // Remove completed:YYYY-MM-DD or done:YYYY-MM-DD
                    inner = inner.replace(/\s*(?:completed|done):\d{4}-\d{2}-\d{2}\s*/g, ' ').trim();

                    if (inner.length > 0) {
                        newLineContent = newLineContent.replace(metaRegex, ` (${inner})`);
                    } else {
                        // Remove empty parens
                        newLineContent = newLineContent.replace(metaRegex, '');
                    }
                }
            }

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

    function injectCommentInteractions() {
        const comments = document.querySelectorAll('.glint-comment');
        comments.forEach(comment => {
            const el = comment as HTMLElement;
            if (el.dataset.initialized) return;
            el.dataset.initialized = 'true';

            const replyBtn = el.querySelector('.btn-reply') as HTMLElement;
            const resolveBtn = el.querySelector('.btn-resolve') as HTMLElement;
            const header = el.querySelector('.glint-comment-header') as HTMLElement;

            if (header) {
                header.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const isCollapsed = el.getAttribute('data-collapsed') === 'true';
                    el.setAttribute('data-collapsed', isCollapsed ? 'false' : 'true');
                };
            }

            if (replyBtn) {
                replyBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    showReplyInput(el);
                };
            }

            if (resolveBtn) {
                resolveBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    resolveThread(el);
                };
            }

            // Auto-open reply box for NEW/EMPTY threads OR threads that only have 
            // the system message (which happens on failed parsing of initial message)
            const thread = el.querySelector('.glint-comment-thread');
            const items = el.querySelectorAll('.glint-comment-item');
            const isResolved = el.getAttribute('data-resolved') === 'true';

            // If it's empty OR only has one message that is empty/system, auto-open
            const isEmpty = items.length === 0;
            const onlySystem = items.length === 1 && items[0].querySelector('.comment-author')?.textContent === 'system';

            if ((isEmpty || onlySystem) && !isResolved) {
                const sLine = el.getAttribute('data-source-line');
                console.log('[Glint] Auto-opening reply for empty/system thread', sLine);
                // canDeleteOnCancel = true because it's an empty thread
                setTimeout(() => showReplyInput(el, true), 50);
            }
        });
    }

    function showReplyInput(commentNode: HTMLElement, canDeleteOnCancel: boolean = false) {
        const actions = commentNode.querySelector('.glint-comment-actions');
        if (!actions) return;

        // Hide actions, show input
        (actions as HTMLElement).style.display = 'none';

        const inputContainer = document.createElement('div');
        inputContainer.className = 'glint-comment-reply-form';
        inputContainer.style.marginTop = '0.5rem';
        inputContainer.style.display = 'flex';
        inputContainer.style.flexDirection = 'column';
        inputContainer.style.gap = '0.5rem';

        const textarea = document.createElement('textarea');
        textarea.className = 'glint-input';
        textarea.placeholder = 'Write a reply...';
        textarea.rows = 3;
        textarea.style.width = '100%';
        textarea.style.padding = '0.5rem';
        textarea.style.borderRadius = '4px';
        textarea.style.border = '1px solid var(--border)';
        textarea.style.background = 'var(--bg-primary)';
        textarea.style.color = 'var(--text-main)';
        textarea.style.resize = 'vertical';

        const buttons = document.createElement('div');
        buttons.style.display = 'flex';
        buttons.style.gap = '0.5rem';

        const sendBtn = document.createElement('button');
        sendBtn.className = 'glint-btn';
        sendBtn.style.background = 'var(--comment-accent)';
        sendBtn.style.color = 'white';
        sendBtn.innerText = 'Send Reply';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'glint-btn';
        cancelBtn.innerText = 'Cancel';

        buttons.appendChild(sendBtn);
        buttons.appendChild(cancelBtn);

        inputContainer.appendChild(textarea);
        inputContainer.appendChild(buttons);

        commentNode.appendChild(inputContainer);
        textarea.focus();

        cancelBtn.onclick = () => {
            if (canDeleteOnCancel) {
                deleteCommentBlock(commentNode);
            } else {
                inputContainer.remove();
                (actions as HTMLElement).style.display = '';
            }
        };

        sendBtn.onclick = async () => {
            const message = textarea.value.trim();
            if (!message) return;

            try {
                sendBtn.disabled = true;
                sendBtn.innerText = 'Sending...';
                await submitReply(commentNode, message);
                inputContainer.remove();
                (actions as HTMLElement).style.display = '';
            } catch (err: any) {
                alert('Failed to send reply: ' + err.message);
                sendBtn.disabled = false;
                sendBtn.innerText = 'Send Reply';
            }
        };
    }

    async function submitReply(commentNode: HTMLElement, message: string) {
        let author = localStorage.getItem('glint-author');
        if (!author) {
            author = prompt('Enter your name for comments:');
            if (author) {
                localStorage.setItem('glint-author', author);
            } else {
                author = 'anonymous';
            }
        }

        const sourceLine = commentNode.getAttribute('data-source-line');
        if (!sourceLine) throw new Error('No source mapping');

        const path = window.location.pathname.substring(1) || 'README.md';

        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const timeStr = now.toTimeString().substring(0, 5);

        // Format: author@YYYY-MM-DD:HH:MM message
        const newLine = `${author}@${dateStr}:${timeStr} ${message}`;

        const res = await fetch(`/api/source/${path}`);
        if (!res.ok) throw new Error('Failed to load source');
        const { content, hash } = await res.json();

        // We need to append to the CODE BLOCK. 
        // The sourceLine points to the OPENING fence (```comment).
        // We need to find the closing fence and insert BEFORE it.
        const lines = content.split('\n');
        const startLine = parseInt(sourceLine);

        // sourceLine is 1-indexed, lines array is 0-indexed
        // Opening fence is at lines[startLine - 1]
        // Content starts at lines[startLine - 1 + 1] = lines[startLine]
        // So we search from startLine (which in 0-indexed points to first content line)
        let endLineIndex = -1;
        for (let i = startLine; i < lines.length; i++) {
            if (lines[i].trim().startsWith('```')) {
                endLineIndex = i;
                break;
            }
        }

        if (endLineIndex === -1) throw new Error('Could not find closing fence');

        // Insert before closing fence
        lines.splice(endLineIndex, 0, newLine);

        const newFullContent = lines.join('\n');

        const saveRes = await fetch('/api/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path, content: newFullContent, hash })
        });

        if (!saveRes.ok) throw new Error((await saveRes.json()).error);

        saveScrollPosition();
        suppressSSEReload();
        window.location.reload();
    }

    async function deleteCommentBlock(commentNode: HTMLElement) {
        const sourceLine = commentNode.getAttribute('data-source-line');
        if (!sourceLine) return;

        const path = window.location.pathname.substring(1) || 'README.md';
        const startLine = parseInt(sourceLine);

        try {
            const res = await fetch(`/api/source/${path}`);
            if (!res.ok) throw new Error('Failed to load source');
            const { content, hash } = await res.json();
            const lines = content.split('\n');

            // Find closing fence
            let endLineIndex = -1;
            for (let i = startLine; i < lines.length; i++) {
                if (lines[i] && lines[i].trim().startsWith('```')) {
                    endLineIndex = i;
                    break;
                }
            }

            if (endLineIndex === -1) throw new Error('Could not find closing fence');

            // Calculate range (including opening fence at startLine - 1)
            let deleteFrom = startLine - 1;
            // Also cleanup potential leading empty line added during insertion
            if (deleteFrom > 0 && lines[deleteFrom - 1].trim() === '') {
                deleteFrom--;
            }

            // Also cleanup potential trailing empty line added during insertion
            let deleteTo = endLineIndex;
            if (deleteTo < lines.length - 1 && lines[deleteTo + 1].trim() === '') {
                deleteTo++;
            }

            const count = deleteTo - deleteFrom + 1;
            lines.splice(deleteFrom, count);

            const newFullContent = lines.join('\n');

            const saveRes = await fetch('/api/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path, content: newFullContent, hash })
            });

            if (!saveRes.ok) throw new Error((await saveRes.json()).error);

            saveScrollPosition();
            suppressSSEReload();
            window.location.reload();
        } catch (err: any) {
            alert('Error deleting: ' + err.message);
        }
    }

    async function resolveThread(commentNode: HTMLElement) {
        const sourceLine = commentNode.getAttribute('data-source-line');
        if (!sourceLine) return;

        if (!confirm('Resolve this thread?')) return;

        const path = window.location.pathname.substring(1) || 'README.md';
        const startLine = parseInt(sourceLine);

        try {
            const res = await fetch(`/api/source/${path}`);
            if (!res.ok) throw new Error('Failed to load source');
            const { content, hash } = await res.json();
            const lines = content.split('\n');

            // The content starts at startLine (1-based from HAST usually means the line OF the element)
            // For code block, startLine is ```comment.
            // Content starts at startLine index (because array is 0-indexed, line 1 is index 0)
            // Wait, startLine is usually 1-indexed. lines[startLine-1] is the ```comment.
            // Content starts at lines[startLine].

            // Check if #resolved exists
            const firstContentLine = lines[startLine]; // Line AFTER opening fence
            if (firstContentLine.trim() === '#resolved') return; // Already resolved

            // Insert #resolved
            lines.splice(startLine, 0, '#resolved');

            const newFullContent = lines.join('\n');

            const saveRes = await fetch('/api/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path, content: newFullContent, hash })
            });

            if (!saveRes.ok) throw new Error((await saveRes.json()).error);

            saveScrollPosition();
            suppressSSEReload();
            window.location.reload();
        } catch (err: any) {
            alert('Error resolving: ' + err.message);
        }
    }

    // Keyboard Shortcuts
    function setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ignore if in an input/textarea/contenteditable
            const target = e.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

            // Ignore if any modifier is pressed (let browser handle those)
            if (e.metaKey || e.ctrlKey || e.altKey) return;

            // 'c' — Insert comment block after current section
            if (e.key === 'c') {
                e.preventDefault();
                const hint = document.querySelector('.line-tracker-hint') as HTMLElement;
                if (hint) {
                    const match = hint.textContent?.match(/L(\d+)/);
                    if (match) {
                        insertCommentBlock(match[1], hint.dataset.nextLine);
                    }
                }
                return;
            }

            // 'e' — Edit current section
            if (e.key === 'e') {
                e.preventDefault();
                editCurrentSection();
                return;
            }
        });
    }

    async function insertCommentBlock(sourceLine?: string, nextLine?: string) {
        const path = window.location.pathname.substring(1) || 'README.md';

        let startLine = 0;
        if (sourceLine) {
            startLine = parseInt(sourceLine);
        } else {
            // Find the element under the user's focus/hover
            const hovered = document.querySelector(':hover[data-source-line]') as HTMLElement;
            const focusedSection = hovered?.closest('[data-source-line]') as HTMLElement;

            if (!focusedSection) {
                alert('Hover over a section first, then press \'c\' to comment.');
                return;
            }

            const sLine = focusedSection.getAttribute('data-source-line');
            if (sLine) startLine = parseInt(sLine);
        }

        if (!startLine) return;

        try {
            const res = await fetch(`/api/source/${path}`);
            if (!res.ok) throw new Error('Failed to load source');
            const { content, hash } = await res.json();

            const lines = content.split('\n');

            // Find the end of this section
            let insertAt = startLine;

            if (nextLine) {
                // If we know the next line, insert right before it
                insertAt = parseInt(nextLine) - 1;
            } else {
                // Otherwise, check if it's a code block
                const currentLineText = lines[startLine - 1]?.trim() || '';
                if (currentLineText && currentLineText.startsWith('```')) {
                    // Find closing fence
                    for (let i = startLine; i < lines.length; i++) {
                        if (lines[i] && lines[i].trim().startsWith('```')) {
                            insertAt = i + 1;
                            break;
                        }
                    }
                }
            }

            // Insert comment block
            lines.splice(insertAt, 0, '', '```comment', '```', '');

            const newContent = lines.join('\n');

            const saveRes = await fetch('/api/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path, content: newContent, hash })
            });

            if (!saveRes.ok) throw new Error((await saveRes.json()).error);

            saveScrollPosition();
            suppressSSEReload();
            window.location.reload();
        } catch (err: any) {
            alert('Failed to insert comment: ' + err.message);
        }
    }

    function editCurrentSection() {
        // Find hovered heading
        const hovered = document.querySelector('h1:hover, h2:hover, h3:hover, h4:hover, h5:hover, h6:hover') as HTMLElement;
        if (hovered) {
            const sourceLine = hovered.getAttribute('data-source-line');
            if (sourceLine) {
                openInlineEditor(hovered, parseInt(sourceLine));
                return;
            }
        }

        // Fallback: find any hovered element with data-source-line
        const anyHovered = document.querySelector(':hover[data-source-line]') as HTMLElement;
        if (anyHovered) {
            const heading = anyHovered.closest('h1, h2, h3, h4, h5, h6') as HTMLElement;
            if (heading) {
                const sourceLine = heading.getAttribute('data-source-line');
                if (sourceLine) {
                    openInlineEditor(heading, parseInt(sourceLine));
                    return;
                }
            }
        }

        alert('Hover over a section, then press \'e\' to edit.');
    }

    // Line Tracker: horizontal guide line + shortcut hint
    function setupLineTracker() {
        // Prevent duplicates on SPA navigation
        if (document.querySelector('.glint-line-tracker')) return;

        const content = document.querySelector('.content-wrapper') as HTMLElement;
        if (!content) return;

        // Create tracker elements
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

            // Find the top-level block under the cursor
            // This ensures we stay between major units and "skip" internal lines of code blocks/widgets.
            const focusedSection = target.closest('.content-wrapper > [data-source-line]') as HTMLElement;

            if (focusedSection) {
                const rect = focusedSection.getBoundingClientRect();
                const contentRect = content.getBoundingClientRect();
                const sourceLine = focusedSection.getAttribute('data-source-line');

                // Update debug info
                hint.textContent = `L${sourceLine || '?'} (c)omment / (e)dit`;

                // Calculate target Y position (midpoint between this and next block)
                let targetY = rect.bottom;

                // Find next sibling that has a source line
                let nextSection = focusedSection.nextElementSibling as HTMLElement;
                while (nextSection && !nextSection.hasAttribute('data-source-line')) {
                    nextSection = nextSection.nextElementSibling as HTMLElement;
                }

                if (nextSection) {
                    const nextRect = nextSection.getBoundingClientRect();
                    targetY = (rect.bottom + nextRect.top) / 2;
                    const nextLine = nextSection.getAttribute('data-source-line');
                    hint.dataset.nextLine = nextLine || '';
                } else {
                    // Fallback for last element: add a small padding
                    targetY = rect.bottom + 8;
                    hint.dataset.nextLine = '';
                }

                // Snap to calculated midpoint
                tracker.style.top = `${targetY}px`;

                // Visual line matches content width
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

        // Hide while editor is active
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
    }

    init();
    document.addEventListener('glint:navigated', init);
});


import { saveScrollPosition, suppressSSEReload } from './scroll-utils.js';
import { canEdit } from './permissions.js';

declare const GlintEditor: any;
const VIM_MODE_KEY = 'glint-vim-mode';

declare global {
    interface Window {
        __glintEditingActive?: boolean;
        __glintPendingReload?: boolean;
    }
}

let activeEditor: any = null;
let activeEditorContainer: HTMLElement | null = null;
let hiddenElements: HTMLElement[] = [];

export function getIsEditingActive(): boolean {
    return !!activeEditor;
}

export function getVimModePreference(): boolean {
    const stored = localStorage.getItem(VIM_MODE_KEY);
    return stored === null ? true : stored === 'true';
}

export function closeInlineEditor() {
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

    window.__glintEditingActive = false;

    if (window.__glintPendingReload) {
        window.__glintPendingReload = false;
        saveScrollPosition();
        window.location.reload();
    }
}

export async function openPreambleEditor() {
    if (!canEdit()) return;
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
        const firstRenderedHeading = document.querySelector('.content-wrapper h1, .content-wrapper h2, .content-wrapper h3, .content-wrapper h4, .content-wrapper h5, .content-wrapper h6');
        let endLine = lines.length + 1;

        if (firstRenderedHeading) {
            const lineAttr = firstRenderedHeading.getAttribute('data-source-line');
            if (lineAttr) endLine = parseInt(lineAttr);
        }

        const preambleContent = lines.slice(0, endLine - 1).join('\n');
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

        const articleHeader = document.querySelector('.article-header') as HTMLElement;

        hiddenElements = sectionElements;
        activeEditorContainer = document.createElement('div');
        activeEditorContainer.className = 'glint-inline-editor-container';

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
                vimMode: getVimModePreference(),
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

export async function openInlineEditor(el: HTMLElement, startLine: number, endLineIndexArg?: number, initialRelativeLine?: number) {
    if (!canEdit()) return;
    if (activeEditor) {
        if (!confirm('You have an active editor open. Discard changes?')) return;
        closeInlineEditor();
    }

    let endLineIndex = endLineIndexArg || -1;

    if (endLineIndex === -1 && el.tagName.match(/^H[1-6]$/)) {
        const headingLevel = parseInt(el.tagName.substring(1));
        const allHeadings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')) as HTMLElement[];
        const headingIndex = allHeadings.indexOf(el);
        for (let i = headingIndex + 1; i < allHeadings.length; i++) {
            const nextLevel = parseInt(allHeadings[i].tagName.substring(1));
            if (nextLevel <= headingLevel) {
                const endAttr = allHeadings[i].getAttribute('data-source-line');
                if (endAttr) {
                    endLineIndex = parseInt(endAttr);
                    break;
                }
            }
        }
    }

    const contentWrapper = el.closest('.content-wrapper') || document.body;
    const allElements = Array.from(contentWrapper.querySelectorAll('[data-source-line]')) as HTMLElement[];
    const sectionElements: HTMLElement[] = [];

    for (const item of allElements) {
        const lineAttr = item.getAttribute('data-source-line');
        if (!lineAttr) continue;
        const line = parseInt(lineAttr);
        if (line >= startLine && (endLineIndex === -1 || line < endLineIndex)) {
            sectionElements.push(item);
        }
    }

    const path = window.location.pathname.substring(1) || 'README.md';

    try {
        el.style.cursor = 'wait';
        const res = await fetch(`/api/source/${path}`);
        if (!res.ok) throw new Error('Failed to load source');
        const { content, hash } = await res.json();

        const lines = content.split('\n');
        const sectionLines = lines.slice(startLine - 1, endLineIndex === -1 ? undefined : endLineIndex - 1);
        const sectionContent = sectionLines.join('\n');

        hiddenElements = sectionElements;
        activeEditorContainer = document.createElement('div');
        activeEditorContainer.className = 'glint-inline-editor-container';

        el.parentNode?.insertBefore(activeEditorContainer, el);
        hiddenElements.forEach(item => item.style.display = 'none');

        window.__glintEditingActive = true;

        if (typeof GlintEditor !== 'undefined') {
            activeEditor = new GlintEditor(activeEditorContainer, {
                initialValue: sectionContent,
                initialLine: initialRelativeLine,
                vimMode: getVimModePreference(),
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
        el.style.cursor = '';
    }
}

export async function openCodeBlockEditor(pre: HTMLElement, startLine: number, language: string) {
    if (!canEdit()) return;
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
        let endLineIndex = -1;

        for (let i = startLine; i < lines.length; i++) {
            if (lines[i].trim().startsWith('```')) {
                endLineIndex = i + 1;
                break;
            }
        }

        if (endLineIndex === -1) {
            throw new Error('Could not find closing code fence.');
        }

        const innerLines = lines.slice(startLine, endLineIndex - 1);
        const innerContent = innerLines.join('\n');

        hiddenElements = [pre];
        activeEditorContainer = document.createElement('div');
        activeEditorContainer.className = 'glint-inline-editor-container';

        pre.parentNode?.insertBefore(activeEditorContainer, pre);
        pre.style.display = 'none';

        if (typeof GlintEditor !== 'undefined') {
            activeEditor = new GlintEditor(activeEditorContainer, {
                initialValue: innerContent,
                vimMode: getVimModePreference(),
                language: language,
                onSave: async (editedInnerContent: string) => {
                    const fenceStart = lines[startLine - 1];
                    const fenceEnd = lines[endLineIndex - 1];
                    const newBlock = `${fenceStart}\n${editedInnerContent}\n${fenceEnd}`;

                    const newLines = [...lines];
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

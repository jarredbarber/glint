
import { insertCommentBlock } from './editor-comments.js';
import { openInlineEditor } from './editor-sessions.js';
import { canEdit, canComment } from './permissions.js';

let shortcutsAttached = false;

export function setupKeyboardShortcuts() {
    if (shortcutsAttached) return;
    shortcutsAttached = true;

    document.addEventListener('keydown', (e) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
        if (e.metaKey || e.ctrlKey || e.altKey) return;

        if (e.key === 'c' && canComment()) {
            e.preventDefault();
            const hint = document.querySelector('.line-tracker-hint') as HTMLElement;
            if (hint) {
                const line = hint.dataset.line || hint.textContent?.match(/L(\d+)/)?.[1];
                if (line) {
                    insertCommentBlock(line, hint.dataset.nextLine);
                }
            }
            return;
        }

        if (e.key === 'e' && canEdit()) {
            e.preventDefault();
            editCurrentSection();
            return;
        }

        if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
            e.preventDefault();
            const help = document.getElementById('shortcuts-help-overlay');
            if (help) {
                help.style.display = 'flex';
            }
            return;
        }

        if (e.key === 'Escape') {
            const help = document.getElementById('shortcuts-help-overlay');
            if (help) help.style.display = 'none';
        }
    });
}

function editCurrentSection() {
    const hint = document.querySelector('.line-tracker-hint') as HTMLElement;
    if (!hint) return;

    // dataset.line is set by the tracker and is more reliable than parsing textContent
    const lineStr = hint.dataset.line || hint.textContent?.match(/L(\d+)/)?.[1];
    if (!lineStr) return;

    const targetLine = parseInt(lineStr);
    const contentWrapper = document.querySelector('.content-wrapper') as HTMLElement;
    if (!contentWrapper) return;

    // Find the last heading in content-wrapper that precedes targetLine
    const headings = Array.from(
        contentWrapper.querySelectorAll('h1[data-source-line], h2[data-source-line], h3[data-source-line], h4[data-source-line], h5[data-source-line], h6[data-source-line]')
    ) as HTMLElement[];

    let sectionHeading: HTMLElement | null = null;
    let sectionStartLine = targetLine;

    for (let i = headings.length - 1; i >= 0; i--) {
        const hLine = parseInt(headings[i].getAttribute('data-source-line') || '0');
        if (hLine <= targetLine) {
            sectionHeading = headings[i];
            sectionStartLine = hLine;
            break;
        }
    }

    if (!sectionHeading) {
        // Target is before the first heading — open inline editor at the target element
        const target = document.querySelector(`[data-source-line="${targetLine}"]`) as HTMLElement;
        openInlineEditor(target || contentWrapper, targetLine);
        return;
    }

    const relativeLine = targetLine - sectionStartLine + 1;
    openInlineEditor(sectionHeading, sectionStartLine, undefined, relativeLine);
}

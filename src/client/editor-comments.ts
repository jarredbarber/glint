
import { saveScrollPosition, suppressSSEReload } from './scroll-utils.js';
import { canComment } from './permissions.js';

export function injectCommentInteractions() {
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

        if (!canComment()) {
            // Remove reply/resolve buttons if no permission
            if (replyBtn) replyBtn.remove();
            if (resolveBtn) resolveBtn.remove();
            return;
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

        const items = el.querySelectorAll('.glint-comment-item');
        const isResolved = el.getAttribute('data-resolved') === 'true';
        const isEmpty = items.length === 0;
        const onlySystem = items.length === 1 && items[0].querySelector('.comment-author')?.textContent === 'system';

        if ((isEmpty || onlySystem) && !isResolved) {
            setTimeout(() => showReplyInput(el, true), 50);
        }
    });
}

export function showReplyInput(commentNode: HTMLElement, canDeleteOnCancel: boolean = false) {
    if (!canComment()) return;
    const actions = commentNode.querySelector('.glint-comment-actions');
    if (!actions) return;

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

export async function submitReply(commentNode: HTMLElement, message: string) {
    if (!canComment()) return;
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
    const newLine = `${author}@${dateStr}:${timeStr} ${message}`;

    const res = await fetch(`/api/source/${path}`);
    if (!res.ok) throw new Error('Failed to load source');
    const { content, hash } = await res.json();

    const lines = content.split('\n');
    const startLine = parseInt(sourceLine);

    // Determine fence length from the opening line
    const openingLine = lines[startLine - 1];
    const fenceMatch = openingLine.match(/^(\s*)(`{3,})/);
    const minFenceLength = fenceMatch ? fenceMatch[2].length : 3;

    let endLineIndex = -1;
    for (let i = startLine; i < lines.length; i++) {
        const line = lines[i].trim();
        // Closing fence must be just backticks and at least as long as opening fence
        const match = line.match(/^(`{3,})$/);
        if (match && match[1].length >= minFenceLength) {
            endLineIndex = i;
            break;
        }
    }

    if (endLineIndex === -1) throw new Error('Could not find closing fence');
    lines.splice(endLineIndex, 0, newLine);

    await saveContent(path, lines.join('\n'), hash);
}

export async function deleteCommentBlock(commentNode: HTMLElement) {
    if (!canComment()) return;
    const sourceLine = commentNode.getAttribute('data-source-line');
    if (!sourceLine) return;

    const path = window.location.pathname.substring(1) || 'README.md';
    const startLine = parseInt(sourceLine);

    try {
        const res = await fetch(`/api/source/${path}`);
        if (!res.ok) throw new Error('Failed to load source');
        const { content, hash } = await res.json();
        const lines = content.split('\n');

        // Determine fence length from the opening line
        const openingLine = lines[startLine - 1];
        const fenceMatch = openingLine.match(/^(\s*)(`{3,})/);
        const minFenceLength = fenceMatch ? fenceMatch[2].length : 3;

        let endLineIndex = -1;
        for (let i = startLine; i < lines.length; i++) {
            const line = lines[i].trim();
            const match = line.match(/^(`{3,})$/);
            if (match && match[1].length >= minFenceLength) {
                endLineIndex = i;
                break;
            }
        }

        if (endLineIndex === -1) throw new Error('Could not find closing fence');

        let deleteFrom = startLine - 1;
        if (deleteFrom > 0 && lines[deleteFrom - 1].trim() === '') {
            deleteFrom--;
        }

        let deleteTo = endLineIndex;
        if (deleteTo < lines.length - 1 && lines[deleteTo + 1].trim() === '') {
            deleteTo++;
        }

        const count = deleteTo - deleteFrom + 1;
        lines.splice(deleteFrom, count);

        await saveContent(path, lines.join('\n'), hash);
    } catch (err: any) {
        alert('Error deleting: ' + err.message);
    }
}

export async function resolveThread(commentNode: HTMLElement) {
    if (!canComment()) return;
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

        const firstContentLine = lines[startLine];
        if (firstContentLine.trim() === '#resolved') return;

        lines.splice(startLine, 0, '#resolved');

        await saveContent(path, lines.join('\n'), hash);
    } catch (err: any) {
        alert('Error resolving: ' + err.message);
    }
}

export async function insertCommentBlock(sourceLine?: string, nextLine?: string) {
    if (!canComment()) return;
    const path = window.location.pathname.substring(1) || 'README.md';

    let startLine = 0;
    if (sourceLine) {
        startLine = parseInt(sourceLine);
    } else {
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
        let insertAt = startLine;

        if (nextLine) {
            insertAt = parseInt(nextLine) - 1;
        } else {
            const currentLineText = lines[startLine - 1]?.trim() || '';
            const fenceMatch = currentLineText.match(/^(`{3,})/);

            if (fenceMatch) {
                // If we are on a fence line (code block or existing comment), insert AFTER the block
                const minFenceLength = fenceMatch[1].length;
                for (let i = startLine; i < lines.length; i++) {
                    const line = lines[i].trim();
                    const match = line.match(/^(`{3,})$/);
                    if (match && match[1].length >= minFenceLength) {
                        insertAt = i + 1;
                        break;
                    }
                }
            }
        }

        lines.splice(insertAt, 0, '', '```comment', '```', '');

        await saveContent(path, lines.join('\n'), hash);
    } catch (err: any) {
        alert('Failed to insert comment: ' + err.message);
    }
}

async function saveContent(path: string, content: string, hash: string) {
    const saveRes = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content, hash })
    });

    if (!saveRes.ok) throw new Error((await saveRes.json()).error);

    saveScrollPosition();
    suppressSSEReload();
    window.location.reload();
}

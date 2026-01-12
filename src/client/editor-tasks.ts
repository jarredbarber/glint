
import { saveScrollPosition, suppressSSEReload } from './scroll-utils.js';
import { canEdit } from './permissions.js';

export function injectTaskInteractions() {
    if (!canEdit()) return;
    const checks = document.querySelectorAll('.glint-task-check');
    checks.forEach(check => {
        const el = check as HTMLElement;
        if (el.dataset.initialized) return;
        el.dataset.initialized = 'true';

        el.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();

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
                { icon: '⛔', marker: '[b]', label: 'Blocked' },
                { icon: '🚫', marker: '[c]', label: 'Cancelled' }
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

            const closeHandler = () => {
                taskNode.classList.remove('picker-open');
                picker.remove();
                document.removeEventListener('click', closeHandler);
            };
            setTimeout(() => document.addEventListener('click', closeHandler), 0);
        };
    });
}

export async function updateTaskState(taskNode: HTMLElement, newMarker: string) {
    if (!canEdit()) return;
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

        let newLineContent = lineContent.replace(/^(\s*-?\s*)\[[ x/wbc]\]/i, `$1${newMarker}`);

        const metaRegex = /\s*\(([^)]+)\)$/;
        const hasMeta = metaRegex.exec(newLineContent);
        const today = new Date().toISOString().split('T')[0];

        if (newMarker === '[x]') {
            if (hasMeta) {
                if (!hasMeta[1].match(/(?:completed|done):/)) {
                    const newMeta = `${hasMeta[1]} completed:${today}`;
                    newLineContent = newLineContent.replace(metaRegex, ` (${newMeta})`);
                }
            } else {
                newLineContent = `${newLineContent} (completed:${today})`;
            }
        } else {
            if (hasMeta) {
                let inner = hasMeta[1];
                inner = inner.replace(/\s*(?:completed|done):\d{4}-\d{2}-\d{2}\s*/g, ' ').trim();
                if (inner.length > 0) {
                    newLineContent = newLineContent.replace(metaRegex, ` (${inner})`);
                } else {
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

// Section-as-unit editor orchestration over the storage seam (issue #8).
// Manual smoke (against FakeAdapter via the app shell): load a multi-section doc,
// press `e` mid-doc, assert the editor opens showing exactly that section's source,
// edit, save, and confirm the section re-renders with no neighbor clobbered.
// getSectionRange's boundary math is unit-tested (section-range.test.ts).
import { getSectionRange } from './section-range.js';
import { StorageAdapter, AuthExpiredError, ConflictError } from '../storage/types.js';

let active: any = null;                 // GlintEditor instance
let container: HTMLElement | null = null;
let hidden: HTMLElement[] = [];
let editorGeneration = 0;

// Last known pointer position, so `e` opens the editor on the section under the
// cursor rather than the topmost visible one (#44). null until the mouse moves.
let lastPointer: { x: number; y: number } | null = null;
let pointerTracking = false;

function trackPointer(): void {
    if (pointerTracking) return;
    pointerTracking = true;
    document.addEventListener('mousemove', (e) => { lastPointer = { x: e.clientX, y: e.clientY }; }, { passive: true });
}

export function getCurrentSection(headerOffset = 0): HTMLElement | null {
    const wrapper = document.querySelector<HTMLElement>('.content-wrapper') ?? document.body;

    // Prefer the section under the cursor.
    if (lastPointer) {
        const under = document.elementFromPoint(lastPointer.x, lastPointer.y);
        const section = under?.closest<HTMLElement>('.glint-section');
        if (section && wrapper.contains(section)) return section;
    }

    // Fall back to the section nearest the vertical center of the viewport
    // (better for keyboard-only use than always grabbing the topmost one).
    const sections = Array.from(wrapper.querySelectorAll<HTMLElement>('.glint-section'));
    const mid = window.innerHeight / 2;
    let best: HTMLElement | null = null;
    let bestDist = Infinity;
    for (const s of sections) {
        const rect = s.getBoundingClientRect();
        if (rect.bottom <= headerOffset) continue;   // scrolled above the header
        const dist = Math.abs((rect.top + rect.bottom) / 2 - mid);
        if (dist < bestDist) { bestDist = dist; best = s; }
    }
    return best ?? wrapper.querySelector<HTMLElement>('[data-source-line]');
}

export function closeSectionEditor(): void {
    editorGeneration += 1;
    if (active) { active.destroy(); active = null; }
    if (container) { container.remove(); container = null; }
    hidden.forEach((el) => (el.style.display = ''));
    hidden = [];
}

type SavedCallback = (fileId: string, content: string) => void | Promise<void>;

function showSavingNotice(): HTMLElement {
    const notice = document.createElement('p');
    notice.className = 'glint-editor-saving';
    notice.textContent = 'Saving…';
    container?.appendChild(notice);
    return notice;
}

function showConflictNotice(): void {
    const notice = document.createElement('p');
    notice.className = 'glint-editor-save-conflict';
    notice.textContent = 'Save conflict. Your changes are still in the editor. Copy them, refresh, then reapply.';
    container?.appendChild(notice);
}

function showReconnectNotice(adapter: StorageAdapter): void {
    const notice = document.createElement('p');
    notice.className = 'glint-editor-save-auth';
    const message = document.createElement('span');
    message.textContent = 'Your connection expired. Your changes are still in the editor.';
    const reconnect = document.createElement('button');
    reconnect.className = 'glint-editor-reconnect';
    reconnect.textContent = 'Reconnect';
    reconnect.addEventListener('click', () => {
        void adapter.auth().then(
            () => {
                message.textContent = 'Reconnected. Save again.';
                reconnect.remove();
            },
            () => { message.textContent = 'Reconnect failed. Your changes are still in the editor.'; },
        );
    });
    notice.appendChild(message);
    notice.appendChild(reconnect);
    container?.appendChild(notice);
}

function isAuthExpired(error: unknown): boolean {
    return error instanceof AuthExpiredError || (error instanceof Error && error.name === 'AuthExpiredError');
}

export async function openSectionEditor(adapter: StorageAdapter, fileId: string, section: HTMLElement, vimMode = true, onSaved?: SavedCallback): Promise<void> {
    closeSectionEditor();
    const generation = editorGeneration;

    const { content, version } = await adapter.read(fileId);
    if (generation !== editorGeneration) return;
    const lines = content.split('\n');
    const eof = lines.length + 1;
    const { startLine, endLine } = getSectionRange(section, eof);
    const sectionText = lines.slice(startLine - 1, endLine - 1).join('\n');

    // Hide the section's own subtree (no ±5 buffer, no global heading scan).
    hidden = [section];
    section.style.display = 'none';
    container = document.createElement('div');
    container.className = 'glint-inline-editor-container';
    section.parentNode!.insertBefore(container, section);

    if (typeof (window as any).GlintEditor === 'undefined') {
        closeSectionEditor();
        throw new Error('Editor not loaded');
    }
    const editor = new (window as any).GlintEditor(container, {
        initialValue: sectionText,
        vimMode,
        onSave: async (edited: string) => {
            const next = [...lines];
            next.splice(startLine - 1, endLine - startLine, edited);
            const newContent = next.join('\n');
            const write = () => adapter.write(fileId, newContent, version);
            const finish = async () => {
                closeSectionEditor();                       // close in place, no reload (#54)
                await onSaved?.(fileId, newContent);
            };
            const saving = showSavingNotice();
            try {
                await write();
                await finish();
                return true;
            } catch (e) {
                saving.remove();
                if (e instanceof ConflictError) {
                    showConflictNotice();
                } else if (isAuthExpired(e)) {
                    if (!adapter.reauthenticate) {
                        showReconnectNotice(adapter);
                        return false;
                    }
                    try {
                        await adapter.reauthenticate();
                    } catch {
                        showReconnectNotice(adapter);
                        return false;
                    }
                    try {
                        await write();
                        await finish();
                        return true;
                    } catch (retryError) {
                        if (retryError instanceof ConflictError) {
                            showConflictNotice();
                        } else if (isAuthExpired(retryError)) {
                            showReconnectNotice(adapter);
                        } else {
                            alert(`Save failed: ${(retryError as Error).message}`);
                        }
                    }
                } else {
                    alert(`Save failed: ${(e as Error).message}`);
                }
                return false;
            }
        },
        onCancel: () => {
            if (generation === editorGeneration) closeSectionEditor();
        },
    });
    if (generation !== editorGeneration) {
        editor.destroy();
        return;
    }
    active = editor;
}

export function installEditorShortcuts(adapter: StorageAdapter, currentFileId: () => string | null, vimMode: () => boolean = () => true, onSaved?: SavedCallback): void {
    trackPointer();
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'e' || e.metaKey || e.ctrlKey || e.altKey) return;
        const el = e.target as HTMLElement;
        if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable) return;
        const id = currentFileId();
        if (!id) return;
        if (adapter.capabilities && !adapter.capabilities().canEdit) {
            alert('This source is read-only.');   // #59: no Save affordance without edit permission
            return;
        }
        const section = getCurrentSection(64);
        if (!section) { alert('Scroll to a section first.'); return; }   // never a silent no-op (#8 §2/§4)
        e.preventDefault();
        void openSectionEditor(adapter, id, section, vimMode(), onSaved);
    });
}

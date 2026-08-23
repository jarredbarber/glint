// Section-as-unit editor orchestration over the storage seam (issue #8).
// Manual smoke (against FakeAdapter via the app shell): load a multi-section doc,
// press `e` mid-doc, assert the editor opens showing exactly that section's source,
// edit, save, and confirm the section re-renders with no neighbor clobbered.
// getSectionRange's boundary math is unit-tested (section-range.test.ts).
import { getSectionRange } from './section-range.js';
import { StorageAdapter, ConflictError } from '../storage/types.js';

let active: any = null;                 // GlintEditor instance
let container: HTMLElement | null = null;
let hidden: HTMLElement[] = [];
let editorGeneration = 0;

export function getCurrentSection(headerOffset = 0): HTMLElement | null {
    const wrapper = document.querySelector('.content-wrapper') ?? document.body;
    const sections = Array.from(wrapper.querySelectorAll<HTMLElement>('.glint-section'));
    for (const s of sections) {
        if (s.getBoundingClientRect().bottom > headerOffset) return s;
    }
    return wrapper.querySelector<HTMLElement>('[data-source-line]');
}

export function closeSectionEditor(): void {
    editorGeneration += 1;
    if (active) { active.destroy(); active = null; }
    if (container) { container.remove(); container = null; }
    hidden.forEach((el) => (el.style.display = ''));
    hidden = [];
}

export async function openSectionEditor(adapter: StorageAdapter, fileId: string, section: HTMLElement): Promise<void> {
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
        vimMode: true,
        onSave: async (edited: string) => {
            const next = [...lines];
            next.splice(startLine - 1, endLine - startLine, edited);
            try {
                await adapter.write(fileId, next.join('\n'), version);
                location.reload();
                return true;
            } catch (e) {
                if (e instanceof ConflictError) {
                    const notice = document.createElement('p');
                    notice.className = 'glint-editor-save-conflict';
                    notice.textContent = 'Save conflict. Your changes are still in the editor. Copy them, refresh, then reapply.';
                    container?.appendChild(notice);
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

export function installEditorShortcuts(adapter: StorageAdapter, currentFileId: () => string | null): void {
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'e' || e.metaKey || e.ctrlKey || e.altKey) return;
        const el = e.target as HTMLElement;
        if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable) return;
        const id = currentFileId();
        if (!id) return;
        const section = getCurrentSection(64);
        if (!section) { alert('Scroll to a section first.'); return; }   // never a silent no-op (#8 §2/§4)
        e.preventDefault();
        void openSectionEditor(adapter, id, section);
    });
}

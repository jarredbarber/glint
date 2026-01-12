
import { insertCommentBlock } from './editor-comments.js';
import { openInlineEditor } from './editor-sessions.js';

export function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
        if (e.metaKey || e.ctrlKey || e.altKey) return;

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

        if (e.key === 'e') {
            e.preventDefault();
            editCurrentSection();
            return;
        }
    });
}

function editCurrentSection() {
    const hint = document.querySelector('.line-tracker-hint') as HTMLElement;
    if (hint && hint.textContent) {
        const match = hint.textContent.match(/L(\d+)/);
        if (match) {
            const targetLine = parseInt(match[1]);
            const target = document.querySelector(`.content-wrapper > [data-source-line="${targetLine}"]`) as HTMLElement;
            if (target) {
                const contentWrapper = target.parentElement;
                const allBlocks = Array.from(contentWrapper?.children || []) as HTMLElement[];
                const targetIndex = allBlocks.indexOf(target);

                let sectionHeading = target;
                let sectionStartLine = targetLine;

                for (let i = targetIndex; i >= 0; i--) {
                    if (allBlocks[i].tagName.match(/^H[1-6]$/)) {
                        sectionHeading = allBlocks[i];
                        const hLine = sectionHeading.getAttribute('data-source-line');
                        if (hLine) sectionStartLine = parseInt(hLine);
                        break;
                    }
                }

                const relativeLine = targetLine - sectionStartLine + 1;
                openInlineEditor(sectionHeading, sectionStartLine, undefined, relativeLine);
            }
        }
    }
}

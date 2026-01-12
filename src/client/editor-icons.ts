
/**
 * Editor Icon Injection
 */

import { openInlineEditor, openCodeBlockEditor, openPreambleEditor } from './editor-sessions.js';

export function injectEditIcons() {
    const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    headings.forEach(h => {
        const heading = h as HTMLElement;
        if (heading.querySelector('.heading-edit-icon')) return;

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

    injectPreambleEditIcon();
    injectCodeBlockEditIcons();
}

export function injectCodeBlockEditIcons() {
    const codeBlocks = document.querySelectorAll('pre');
    codeBlocks.forEach(pre => {
        if (pre.parentElement?.classList.contains('code-block-wrapper')) return;

        const sourceLine = pre.getAttribute('data-source-line');
        if (sourceLine === null) return;

        const code = pre.querySelector('code');
        let language = 'text';
        if (code && code.className) {
            const match = code.className.match(/language-(\w+)/);
            if (match) {
                language = match[1];
            }
        }

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

export function injectPreambleEditIcon() {
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

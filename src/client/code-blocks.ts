/**
 * Code Blocks Client
 * Handles both toggling (expand/collapse) and copying for code blocks.
 */

(function () {
    document.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;

        // Handle Collapse Toggle
        const toggle = target.closest('.code-collapse-toggle');
        if (toggle) {
            const wrapper = toggle.closest('.code-block-wrapper');
            if (wrapper) {
                const isCollapsed = wrapper.classList.toggle('collapsed');
                toggle.textContent = isCollapsed ? 'Expand' : 'Collapse';
            }
            return;
        }

        // Handle Copy Button
        const copyBtn = target.closest('.code-copy-button');
        if (copyBtn) {
            const wrapper = copyBtn.closest('.code-block-wrapper');
            const pre = wrapper?.querySelector('pre');
            if (pre) {
                const text = pre.innerText;
                navigator.clipboard.writeText(text).then(() => {
                    const originalText = copyBtn.textContent;
                    copyBtn.textContent = 'Copied!';
                    copyBtn.classList.add('copied');

                    setTimeout(() => {
                        copyBtn.textContent = originalText;
                        copyBtn.classList.remove('copied');
                    }, 2000);
                });
            }
        }
    });
})();

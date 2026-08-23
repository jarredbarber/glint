import { contentBehaviorInit } from './content-behavior.js';

export const renderScripts = (extraScripts: string[] = [], isStatic: boolean = false) => {

const hotReload = isStatic ? '' : `
    // Hot Reloading
    const evtSource = new EventSource("/events");
    let isUnloading = false;

    // Toast Helper (Shared with share.ts pattern but global here)
    function showGlobalToast(message, type = 'error') {
        let container = document.querySelector('.glint-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'glint-toast-container';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = \`glint-toast \${type}\`;
        var icon = document.createElement('span');
        icon.className = 'toast-icon';
        icon.textContent = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
        var msg = document.createElement('span');
        msg.className = 'toast-message';
        msg.textContent = message;
        toast.appendChild(icon);
        toast.appendChild(msg);

        container.appendChild(toast);

        // Auto remove
        setTimeout(() => {
            toast.classList.add('out');
            toast.addEventListener('animationend', () => toast.remove());
        }, 5000);
    }

    evtSource.addEventListener('glint:error', (event) => {
        if (event.data) {
            try {
                const data = JSON.parse(event.data);
                showGlobalToast(data.message, 'error');
            } catch (e) {
                console.error('Failed to parse error event', e);
            }
        }
    });

    window.addEventListener('beforeunload', () => {
        isUnloading = true;
        evtSource.close();
    });

    evtSource.onmessage = (event) => {
        if (event.data === "reload") {
            // Check if inline editor is active
            if (window.__glintEditingActive) {
                console.log("SSE reload suppressed (inline editor active)");
                window.__glintPendingReload = true;
                return;
            }
            // Check if a client-side refresh just happened (suppress SSE reload)
            const suppressTime = sessionStorage.getItem('glint-suppress-reload');
            if (suppressTime && Date.now() - parseInt(suppressTime) < 3000) {
                console.log("SSE reload suppressed (client-side refresh in progress)");
                sessionStorage.removeItem('glint-suppress-reload');
                return;
            }
            console.log("Config changed, reloading...");
            // Save scroll position before reload
            const contentEl = document.querySelector('.content') || document.querySelector('main');
            if (contentEl) {
                sessionStorage.setItem('glint-scroll-y', String(contentEl.scrollTop));
            }
            window.location.reload();
        }
    };

    evtSource.onerror = () => {
        // SSE connection errors are normal during navigation, don't reload
        console.debug('SSE connection error');
    };
`;

return `
${contentBehaviorInit()}
<script>
${hotReload}
    // Copy anchor link to clipboard
    document.addEventListener('click', (e) => {
        const anchor = e.target.closest('.heading-anchor');
        if (anchor) {
            e.preventDefault();
            const url = window.location.origin + window.location.pathname + anchor.getAttribute('href');
            navigator.clipboard.writeText(url).then(() => {
                anchor.classList.add('copied');
                setTimeout(() => anchor.classList.remove('copied'), 1500);
            });
        }
    });
</script>
${isStatic ? `
<!-- Static output uses native navigation (no SPA router): full-page loads
     are instant and reliable on a dumb file host, and avoid the router's
     fetch+swap overhead and stale-listener issues. -->
<script src="/assets/outline.bundle.js"></script>
<script src="/assets/citations.bundle.js"></script>
<script src="/assets/lightbox.bundle.js"></script>
<script src="/assets/code-blocks.bundle.js"></script>
<script src="/assets/mobile-sidebar.bundle.js"></script>
` : `
<script src="/assets/router.bundle.js"></script>
<script src="/assets/upload.bundle.js"></script>
<script src="/assets/editor.bundle.js"></script>
<script src="/assets/editor-integration.bundle.js"></script>
<script src="/assets/outline.bundle.js"></script>
<script src="/assets/image-resize.bundle.js"></script>

<script src="/assets/command-palette.bundle.js"></script>
<script src="/assets/citations.bundle.js"></script>
<script src="/assets/lightbox.bundle.js"></script>
<script src="/assets/code-blocks.bundle.js"></script>
<script src="/assets/mobile-sidebar.bundle.js"></script>
`}
${extraScripts.map(s => `<script src="${s}"></script>`).join('\n')}
`;
}

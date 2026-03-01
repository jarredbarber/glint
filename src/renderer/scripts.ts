export const renderScripts = (shareId?: string, extraScripts: string[] = []) => `
<script>
    // Global share context
    window.__glintShareId = ${shareId ? `'${shareId}'` : 'null'};
    document.addEventListener('DOMContentLoaded', function() {
        if (typeof mermaid !== 'undefined') {
            // Get theme from body class (set by server from config)
            var bodyClass = document.body.className;
            var theme = bodyClass.split(' ')[0] || 'nord';

            // Theme configurations for Mermaid
            // nodeText = text color inside filled nodes, text = label/line color
            var themeConfigs = {
                'default': { base: 'default', primary: '#0366d6', secondary: '#1b7c83', tertiary: '#6f42c1', text: '#24292e', nodeText: '#ffffff', bg: '#ffffff' },
                'everforest-dark': { base: 'dark', primary: '#a7c080', secondary: '#dbbc7f', tertiary: '#e67e80', text: '#d3c6aa', nodeText: '#2d353b', bg: '#2d353b' },
                'nord': { base: 'dark', primary: '#88c0d0', secondary: '#81a1c1', tertiary: '#b48ead', text: '#eceff4', nodeText: '#2e3440', bg: '#2e3440' },
                'gruvbox-dark': { base: 'dark', primary: '#b8bb26', secondary: '#fabd2f', tertiary: '#fb4934', text: '#ebdbb2', nodeText: '#282828', bg: '#282828' },
                'catppuccin-mocha': { base: 'dark', primary: '#89b4fa', secondary: '#f5c2e7', tertiary: '#f38ba8', text: '#cdd6f4', nodeText: '#1e1e2e', bg: '#1e1e2e' },
                'solarized-light': { base: 'default', primary: '#268bd2', secondary: '#2aa198', tertiary: '#d33682', text: '#657b83', nodeText: '#ffffff', bg: '#fdf6e3' },
                'tokyo-night': { base: 'dark', primary: '#7aa2f7', secondary: '#9ece6a', tertiary: '#bb9af7', text: '#c0caf5', nodeText: '#1a1b26', bg: '#1a1b26' },
                'rose-pine': { base: 'dark', primary: '#c4a7e7', secondary: '#9ccfd8', tertiary: '#eb6f92', text: '#e0def4', nodeText: '#191724', bg: '#191724' },
                'dracula': { base: 'dark', primary: '#bd93f9', secondary: '#50fa7b', tertiary: '#ff79c6', text: '#f8f8f2', nodeText: '#282a36', bg: '#282a36' },
                'one-dark': { base: 'dark', primary: '#61afef', secondary: '#98c379', tertiary: '#c678dd', text: '#abb2bf', nodeText: '#282c34', bg: '#282c34' },
                'kanagawa': { base: 'dark', primary: '#7e9cd8', secondary: '#98bb6c', tertiary: '#957fb8', text: '#dcd7ba', nodeText: '#1f1f28', bg: '#1f1f28' },
                'github-light': { base: 'default', primary: '#0969da', secondary: '#1a7f37', tertiary: '#8250df', text: '#1f2328', nodeText: '#ffffff', bg: '#ffffff' }
            };

            var config = themeConfigs[theme] || themeConfigs['nord'];

            mermaid.initialize({
                startOnLoad: true,
                theme: config.base,
                securityLevel: 'loose',
                themeVariables: {
                    fontFamily: '"Inter", sans-serif',
                    primaryColor: config.primary,
                    primaryTextColor: config.nodeText,
                    primaryBorderColor: config.primary,
                    lineColor: config.text,
                    secondaryColor: config.secondary,
                    tertiaryColor: config.tertiary,
                    background: config.bg,
                    mainBkg: config.bg,
                    textColor: config.text
                }
            });
        }
    });

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
<script src="/assets/router.bundle.js"></script>
<script src="/assets/upload.bundle.js"></script>
<script src="/assets/editor.bundle.js"></script>
<script src="/assets/editor-integration.bundle.js"></script>
<script src="/assets/outline.bundle.js"></script>
<script src="/assets/image-resize.bundle.js"></script>

<script src="/assets/share.bundle.js"></script>
<script src="/assets/command-palette.bundle.js"></script>
<script src="/assets/citations.bundle.js"></script>
<script src="/assets/lightbox.bundle.js"></script>
<script src="/assets/code-blocks.bundle.js"></script>
<script src="/assets/mobile-sidebar.bundle.js"></script>
${extraScripts.map(s => `<script src="${s}"></script>`).join('\n')}
`;

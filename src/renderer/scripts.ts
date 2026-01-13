export const renderScripts = (shareId?: string, extraScripts: string[] = []) => `
<script>
    // Global share context
    window.__glintShareId = ${shareId ? `'${shareId}'` : 'null'};
    document.addEventListener('DOMContentLoaded', function() {
        if (typeof mermaid !== 'undefined') {
            // Get theme from localStorage or body class
            var savedTheme = localStorage.getItem('glint-theme');
            var bodyClass = document.body.className;
            var theme = savedTheme || bodyClass || 'nord';

            // Theme configurations for Mermaid
            var themeConfigs = {
                'default': { base: 'default', primary: '#4a90d9', secondary: '#45b7d1', tertiary: '#96ceb4', text: '#333', bg: '#fff' },
                'everforest-dark': { base: 'dark', primary: '#a7c080', secondary: '#dbbc7f', tertiary: '#e67e80', text: '#d3c6aa', bg: '#2d353b' },
                'nord': { base: 'dark', primary: '#88c0d0', secondary: '#81a1c1', tertiary: '#b48ead', text: '#eceff4', bg: '#2e3440' },
                'gruvbox-dark': { base: 'dark', primary: '#b8bb26', secondary: '#fabd2f', tertiary: '#fb4934', text: '#ebdbb2', bg: '#282828' },
                'catppuccin-mocha': { base: 'dark', primary: '#89b4fa', secondary: '#f5c2e7', tertiary: '#f38ba8', text: '#cdd6f4', bg: '#1e1e2e' },
                'solarized-light': { base: 'default', primary: '#268bd2', secondary: '#2aa198', tertiary: '#d33682', text: '#657b83', bg: '#fdf6e3' }
            };

            var config = themeConfigs[theme] || themeConfigs['nord'];

            mermaid.initialize({
                startOnLoad: true,
                theme: config.base,
                securityLevel: 'loose',
                themeVariables: {
                    fontFamily: '"Inter", sans-serif',
                    primaryColor: config.primary,
                    primaryTextColor: config.bg,
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
<script src="/assets/drag-reorder.bundle.js"></script>
<script src="/assets/share.bundle.js"></script>
<script src="/assets/command-palette.bundle.js"></script>
<script src="/assets/citations.bundle.js"></script>
<script src="/assets/lightbox.bundle.js"></script>
<script src="/assets/code-blocks.bundle.js"></script>
<script src="/assets/mobile-sidebar.bundle.js"></script>
${extraScripts.map(s => `<script src="${s}"></script>`).join('\n')}
`;

// Client-side behavior for *rendered content* (as opposed to app-shell chrome):
// drawing mermaid diagrams and abcjs scores that the pipeline emits as inert
// placeholder markup. Shared by the full page (renderer/scripts.ts) and the
// VimR fragment (render.ts) so the init logic and CDN URLs live in exactly one
// place — the two used to drift, which is how a stale selector shipped.

export const MERMAID_CDN = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';
export const ABCJS_CDN = 'https://cdn.jsdelivr.net/npm/abcjs@6/dist/abcjs-basic-min.js';
export const ABCJS_CSS = 'https://cdn.jsdelivr.net/npm/abcjs@6/abcjs-audio.css';

/**
 * A `<script>` that draws mermaid diagrams and abcjs scores on DOMContentLoaded.
 * Theme is read from the body class at runtime and falls back to nord when the
 * class isn't a known theme (e.g. inside VimR, where body is `.markdown-body`).
 * Requires the CDN loaders from {@link contentBehaviorLoaders} to be present.
 */
export function contentBehaviorInit(): string {
    return `<script>
    document.addEventListener('DOMContentLoaded', function() {
        if (typeof mermaid !== 'undefined') {
            var bodyClass = document.body.className;
            var theme = bodyClass.split(' ')[0] || 'nord';
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

        if (typeof ABCJS !== 'undefined') {
            var isDark = document.body.className.split(' ')[0] !== 'default' && document.body.className.split(' ')[0] !== 'solarized-light' && document.body.className.split(' ')[0] !== 'github-light';
            document.querySelectorAll('.abcjs-notation').forEach(function(el) {
                var abc = el.getAttribute('data-abc') || '';
                var tune = ABCJS.renderAbc(el, abc, {
                    responsive: 'resize',
                    add_classes: true,
                    staffwidth: 680,
                    paddingright: 0,
                    paddingleft: 0,
                    format: { gchordfont: 'Inter 12' }
                })[0];
                if (isDark) el.classList.add('abcjs-dark');
                if (tune && ABCJS.synth && ABCJS.synth.supportsAudio()) {
                    var playerEl = document.createElement('div');
                    playerEl.className = 'abcjs-player';
                    el.parentNode.insertBefore(playerEl, el.nextSibling);
                    var synth = new ABCJS.synth.SynthController();
                    synth.load(playerEl, null, { displayLoop: true, displayRestart: true, displayPlay: true, displayProgress: true, displayWarp: false });
                    synth.setTune(tune, false);
                }
            });
        }
    });
</script>`;
}

/**
 * CDN loader tags for mermaid / abcjs, emitted only when the rendered HTML
 * actually contains that kind of block. Keeps documents that use neither from
 * pulling two libraries off a CDN.
 */
export function contentBehaviorLoaders(html: string): string {
    const parts: string[] = [];
    if (/class="mermaid"/.test(html)) {
        parts.push(`<script src="${MERMAID_CDN}"></script>`);
    }
    if (/class="abcjs-notation"/.test(html)) {
        parts.push(`<link rel="stylesheet" href="${ABCJS_CSS}">`);
        parts.push(`<script src="${ABCJS_CDN}"></script>`);
    }
    return parts.join('\n');
}

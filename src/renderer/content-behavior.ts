// Client-side behavior for *rendered content* (as opposed to app-shell chrome):
// drawing mermaid diagrams that the pipeline emits as inert
// placeholder markup. Shared by the full-page renderer (renderer.ts) and the VimR
// fragment (render.ts) so the init logic and CDN URLs live in exactly one
// place — the two used to drift, which is how a stale selector shipped.

export const MERMAID_CDN = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';

// Mermaid theming reads the *active palette's* CSS custom properties (defined on
// :root by every theme file) instead of a hand-maintained per-theme table. That
// keeps diagrams coherent with all palettes — including ones no table covered —
// and means there is only one place colours live. These helpers are self-contained
// and browser-only: the SPA imports them, and the standalone script below embeds
// their source via .toString(), so the two paths cannot drift.
function paletteVar(name: string, fallback: string): string {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
}
function paletteIsDark(): boolean {
    const hex = paletteVar('--bg-color', '#ffffff').replace('#', '');
    const n = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
    const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
}
function mermaidInitOptions(): Record<string, unknown> {
    const text = paletteVar('--text-color', '#24292e');
    const bg = paletteVar('--bg-color', '#ffffff');
    return {
        theme: 'base',
        securityLevel: 'loose',
        themeVariables: {
            darkMode: paletteIsDark(),
            fontFamily: '"Inter", sans-serif',
            background: bg,
            mainBkg: paletteVar('--bg-highlight', bg),
            primaryColor: paletteVar('--bg-highlight', bg),
            primaryTextColor: text,
            primaryBorderColor: paletteVar('--blue', text),
            secondaryColor: paletteVar('--bg-dim', bg),
            secondaryBorderColor: paletteVar('--purple', text),
            tertiaryColor: paletteVar('--bg-secondary', bg),
            tertiaryBorderColor: paletteVar('--green', text),
            lineColor: paletteVar('--text-dim', text),
            textColor: text,
            nodeTextColor: text,
        },
    };
}

/**
 * A `<script>` that draws mermaid diagrams on DOMContentLoaded.
 * Colours come from the active palette's CSS variables at runtime (see the
 * mermaid helpers above, embedded here via .toString() so the standalone page
 * and the SPA share one implementation). Requires the CDN loaders from
 * {@link contentBehaviorLoaders} to be present.
 */
export function contentBehaviorInit(): string {
    // data-glint marks this as renderer-owned so stripScripts keeps it while
    // dropping every user-authored <script> in static output (#65).
    return `<script data-glint>
    ${paletteVar.toString()}
    ${paletteIsDark.toString()}
    ${mermaidInitOptions.toString()}
    document.addEventListener('DOMContentLoaded', function() {
        if (typeof mermaid !== 'undefined') {
            mermaid.initialize(Object.assign({ startOnLoad: true }, mermaidInitOptions()));
        }
    });
</script>`;
}

/**
 * CDN loader tags for mermaid, emitted only when the rendered HTML
 * actually contains a diagram. Keeps documents that use none from
 * pulling a library off a CDN.
 */
export function contentBehaviorLoaders(html: string): string {
    const parts: string[] = [];
    if (/class="mermaid"/.test(html)) {
        parts.push(`<script src="${MERMAID_CDN}"></script>`);
    }
    return parts.join('\n');
}

// --- SPA runtime draw ---------------------------------------------------------
// The standalone `glint-md render` output ships the loaders + init script above and
// the browser runs them on DOMContentLoaded. The SPA renders Markdown to an HTML
// string and injects it with innerHTML, where <script> tags never execute — so it
// must load the CDNs and run the same draw logic itself, on demand, per injected
// subtree. That is what drawContentBehaviors does. Browser-only: never called on
// the Node/standalone path.

const scriptLoads = new Map<string, Promise<void>>();

function loadScriptOnce(src: string): Promise<void> {
    let p = scriptLoads.get(src);
    if (p) return p;
    p = new Promise<void>((resolve, reject) => {
        const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
        if (existing) { resolve(); return; }
        const s = document.createElement('script');
        s.src = src;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(s);
    });
    scriptLoads.set(src, p);
    return p;
}

async function drawMermaid(root: ParentNode): Promise<void> {
    const nodes = Array.from(root.querySelectorAll<HTMLElement>('.mermaid:not([data-processed])'));
    if (nodes.length === 0) return;
    await loadScriptOnce(MERMAID_CDN);
    const mermaid = (window as unknown as { mermaid?: any }).mermaid;
    if (!mermaid) return;
    // Re-initialize each draw so a palette change since the last diagram takes effect.
    mermaid.initialize({ startOnLoad: false, ...mermaidInitOptions() });
    try {
        await mermaid.run({ nodes });
    } catch (err) {
        console.error('[glint] mermaid render failed', err);
    }
}

/**
 * Draw mermaid diagrams inside `root` (default: whole document),
 * loading the CDN library only when a diagram is present. Idempotent:
 * already-drawn nodes are skipped, so it is safe to call after every re-render.
 */
export async function drawContentBehaviors(root: ParentNode = document): Promise<void> {
    await drawMermaid(root);
}

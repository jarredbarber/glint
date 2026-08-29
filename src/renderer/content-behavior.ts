// Client-side behavior for rendered content. Mermaid placeholders are emitted by
// the shared pipeline; both the SPA and portable renderer use this runtime.

export const MERMAID_SRC = './assets/mermaid.min.js';

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
        securityLevel: 'strict',
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
            // #136: edge labels (Yes/No) default to an ugly opaque black box; match the canvas.
            edgeLabelBackground: paletteVar('--bg-highlight', bg),
            lineColor: paletteVar('--text-dim', text),
            textColor: text,
            nodeTextColor: text,
        },
    };
}

/**
 * A `<script>` that draws Mermaid diagrams on DOMContentLoaded.
 * Colours come from the active palette's CSS variables at runtime. Requires the
 * self-hosted loader from {@link contentBehaviorLoaders}.
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
 * Self-hosted Mermaid loader, emitted only when the rendered HTML contains a
 * diagram.
 */
export function contentBehaviorLoaders(html: string): string {
    const parts: string[] = [];
    if (/class="mermaid"/.test(html)) {
        parts.push(`<script data-glint src="${MERMAID_SRC}"></script>`);
    }
    return parts.join('\n');
}

// --- SPA runtime draw ---------------------------------------------------------
// Injected script tags do not execute, so the SPA loads the same-origin runtime
// on demand and then draws each new subtree.

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
    await loadScriptOnce(MERMAID_SRC);
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
 * Draw Mermaid diagrams inside `root`, loading the same-origin runtime only
 * when needed. Already-drawn nodes are skipped.
 */
export async function drawContentBehaviors(root: ParentNode = document): Promise<void> {
    await drawMermaid(root);
}

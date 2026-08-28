import katex from 'katex';
import { escapeHtml } from '../utils/html.js';

// #132: render inline `$...$` KaTeX in a document title. Section headings already
// pass through remark-math/rehype-katex, but the title is rebuilt from raw text,
// so it needs its own pass. ponytail: naive paired-$ split, not remark-math's full
// delimiter rules — fine for a one-line title; route the title through the pipeline
// if it ever needs `\$` escapes or currency disambiguation.
export function renderTitle(title: string, macros: Record<string, string> = {}): string {
    // Match the pipeline's macro keying: `R` in frontmatter means `\R` to KaTeX.
    const keyed = Object.fromEntries(
        Object.entries(macros).map(([k, v]) => [k.startsWith('\\') ? k : `\\${k}`, v]),
    );
    return title.split(/(\$[^$]+\$)/).map((part) => {
        const math = part.match(/^\$([^$]+)\$$/);
        if (!math) return escapeHtml(part);
        try {
            return katex.renderToString(math[1], { throwOnError: false, macros: keyed, strict: false });
        } catch {
            return escapeHtml(part);
        }
    }).join('');
}

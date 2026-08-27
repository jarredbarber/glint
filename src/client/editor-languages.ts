/**
 * Language configuration for CodeMirror 6 with nested parser support.
 * Enables context-dependent syntax highlighting in fenced code blocks.
 */
import { markdown } from "@codemirror/lang-markdown";
import type { MarkdownConfig } from "@lezer/markdown";
import { tags as t } from "@lezer/highlight";
import { LanguageDescription, LanguageSupport, StreamLanguage } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { latex } from "codemirror-lang-latex";

/**
 * List of languages supported in fenced code blocks.
 * Uses lazy-loaded LanguageDescription to only load parsers when needed.
 */
const codeLanguages = [
    LanguageDescription.of({
        name: "javascript",
        alias: ["js", "jsx", "ts", "typescript", "tsx"],
        load: async () => javascript({ jsx: true, typescript: true })
    }),
    LanguageDescription.of({
        name: "python",
        alias: ["py"],
        load: async () => python()
    }),
    LanguageDescription.of({
        name: "html",
        alias: ["htm"],
        load: async () => html()
    }),
    LanguageDescription.of({
        name: "css",
        alias: ["scss", "sass", "less"],
        load: async () => css()
    }),
    LanguageDescription.of({
        name: "latex",
        alias: ["tex"],
        load: async () => latex()
    }),
    LanguageDescription.of({
        name: "rust",
        alias: ["rs"],
        load: async () => (await import("@codemirror/lang-rust")).rust()
    }),
    LanguageDescription.of({
        name: "cpp",
        alias: ["c", "c++", "h", "hpp"],
        load: async () => (await import("@codemirror/lang-cpp")).cpp()
    }),
    LanguageDescription.of({
        name: "java",
        load: async () => (await import("@codemirror/lang-java")).java()
    }),
    LanguageDescription.of({
        name: "go",
        alias: ["golang"],
        load: async () => (await import("@codemirror/lang-go")).go()
    }),
    LanguageDescription.of({
        name: "haskell",
        alias: ["hs"],
        load: async () =>
            new LanguageSupport(StreamLanguage.define((await import("@codemirror/legacy-modes/mode/haskell")).haskell))
    }),
    LanguageDescription.of({
        name: "lisp",
        alias: ["commonlisp", "elisp"],
        load: async () =>
            new LanguageSupport(StreamLanguage.define((await import("@codemirror/legacy-modes/mode/commonlisp")).commonLisp))
    }),
    LanguageDescription.of({
        name: "scheme",
        alias: ["scm", "racket"],
        load: async () =>
            new LanguageSupport(StreamLanguage.define((await import("@codemirror/legacy-modes/mode/scheme")).scheme))
    }),
];

/**
 * #105: Highlight LaTeX math in the editor. One inline parser covers both
 * inline `$..$` (single line) and display `$$..$$` (may span lines within a
 * paragraph). Uses the pandoc rule for inline: opening `$` not followed by
 * whitespace, closing `$` not preceded by whitespace, so prose like "$5 to $10"
 * is left alone. Editor-only; the render pipeline uses remark-math separately.
 */
const DOLLAR = 36;
const isSpace = (c: number) => c === 32 || c === 9 || c === 10;

export const MathHighlight: MarkdownConfig = {
    defineNodes: [
        { name: "InlineMath", style: t.special(t.string) },
        { name: "BlockMath", style: t.special(t.string) },
    ],
    parseInline: [{
        name: "Math",
        parse(cx, next, pos) {
            if (next !== DOLLAR) return -1;
            const double = cx.char(pos + 1) === DOLLAR;
            const delim = double ? 2 : 1;
            const start = pos + delim;
            if (!double && isSpace(cx.char(start))) return -1; // opening rule
            let end = start;
            while (end < cx.end) {
                const c = cx.char(end);
                if (c === DOLLAR) {
                    if (!double) break;
                    if (cx.char(end + 1) === DOLLAR) break;
                    end++; // lone `$` inside display math
                    continue;
                }
                if (!double && c === 10) return -1; // inline math stays on one line
                end++;
            }
            if (end >= cx.end || end === start) return -1;              // unclosed / empty
            if (!double && isSpace(cx.char(end - 1))) return -1;        // closing rule
            return cx.addElement(cx.elt(double ? "BlockMath" : "InlineMath", pos, end + delim));
        }
    }],
};

/**
 * Creates a markdown language configuration with nested language support.
 * Code blocks will automatically highlight based on their language tag.
 */
export function createMarkdownWithNesting() {
    return markdown({
        codeLanguages,
        extensions: [MathHighlight],
    });
}

/**
 * Language configuration for CodeMirror 6 with nested parser support.
 * Enables context-dependent syntax highlighting in fenced code blocks.
 */
import { markdown } from "@codemirror/lang-markdown";
import { LanguageDescription } from "@codemirror/language";
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
];

/**
 * Creates a markdown language configuration with nested language support.
 * Code blocks will automatically highlight based on their language tag.
 */
export function createMarkdownWithNesting() {
    return markdown({
        codeLanguages
    });
}

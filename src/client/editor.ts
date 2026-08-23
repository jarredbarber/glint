import { EditorView, keymap, highlightSpecialChars, drawSelection, highlightActiveLine, dropCursor, lineNumbers, highlightActiveLineGutter } from "@codemirror/view"
import { EditorState } from "@codemirror/state"
import { HighlightStyle, syntaxHighlighting, indentOnInput, bracketMatching, foldGutter, foldKeymap } from "@codemirror/language"
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search"
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete"
import { lintKeymap } from "@codemirror/lint"
import { tags as t } from "@lezer/highlight"
import { emojiCompletionSource } from "./emoji-completion.js"
import { createMarkdownWithNesting } from "./editor-languages.js"
import { vim, Vim } from "@replit/codemirror-vim"
import { javascript } from "@codemirror/lang-javascript"
import { python } from "@codemirror/lang-python"
import { html } from "@codemirror/lang-html"
import { css } from "@codemirror/lang-css"

/**
 * Glint Custom Theme
 * Uses CSS variables from Glint's theme system to stay in sync.
 */
const glintTheme = EditorView.theme({
    "&": {
        color: "var(--text-color)",
        backgroundColor: "var(--bg-color)",
    },
    ".cm-content": {
        caretColor: "var(--aqua)",
        padding: "10px 0"
    },
    "&.cm-focused .cm-cursor": {
        borderLeftColor: "var(--aqua)"
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: "var(--bg-highlight)"
    },
    ".cm-gutters": {
        backgroundColor: "var(--bg-color)",
        color: "var(--text-dim)",
        border: "none",
        borderRight: "1px solid var(--border-color)"
    },
    ".cm-activeLineGutter": {
        backgroundColor: "var(--bg-highlight)",
        color: "var(--text-color)"
    },
    ".cm-activeLine": {
        backgroundColor: "var(--bg-highlight)"
    },
    ".cm-foldPlaceholder": {
        backgroundColor: "transparent",
        border: "none",
        color: "var(--text-dim)"
    },
    ".cm-tooltip": {
        border: "1px solid var(--border-color)",
        backgroundColor: "var(--bg-color)"
    },
    ".cm-tooltip .cm-tooltip-arrow:before": {
        borderTopColor: "var(--border-color)",
        borderBottomColor: "var(--border-color)"
    },
    ".cm-tooltip .cm-tooltip-arrow:after": {
        borderTopColor: "var(--bg-color)",
        borderBottomColor: "var(--bg-color)"
    },
    ".cm-tooltip-autocomplete": {
        "& > ul > li[aria-selected]": {
            backgroundColor: "var(--bg-highlight)",
            color: "var(--text-color)"
        }
    }
}, { dark: true });

/**
 * Syntax highlighting style mapping Glint variables to Lezer tags
 */
const glintHighlightStyle = HighlightStyle.define([
    { tag: t.keyword, color: "var(--purple)" },
    { tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName], color: "var(--blue)" },
    { tag: [t.variableName, t.labelName], color: "var(--blue)" },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--aqua)" },
    { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: "var(--orange)" },
    { tag: [t.string, t.special(t.string), t.inserted], color: "var(--green)" },
    { tag: [t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace], color: "var(--orange)" },
    { tag: [t.escape, t.regexp, t.special(t.character)], color: "var(--red)" },
    { tag: [t.url, t.escape, t.regexp, t.link], color: "var(--blue)", textDecoration: "underline" },
    { tag: t.meta, color: "var(--text-dim)" },
    { tag: t.comment, color: "var(--text-dim)", fontStyle: "italic" },
    { tag: t.strong, fontWeight: "bold" },
    { tag: t.emphasis, fontStyle: "italic" },
    { tag: t.strikethrough, textDecoration: "line-through" },
    { tag: t.heading, fontWeight: "bold", color: "var(--green)" },
    { tag: [t.atom, t.bool, t.special(t.variableName)], color: "var(--orange)" },
    { tag: [t.processingInstruction, t.string, t.inserted], color: "var(--green)" },
    { tag: t.invalid, color: "var(--red)" },
]);

/**
 * Relative line numbers gutter.
 * Shows absolute line number for current line, relative offsets for others.
 */
function relativeLineNumbers() {
    return lineNumbers({
        formatNumber: (lineNo: number, state: EditorState) => {
            const cursorLine = state.doc.lineAt(state.selection.main.head).number;
            if (lineNo === cursorLine) {
                return String(lineNo);
            }
            return String(Math.abs(lineNo - cursorLine));
        }
    });
}

interface GlintEditorOptions {
    initialValue?: string;
    initialLine?: number; // 1-indexed line to scroll to on load
    height?: string;
    onSave?: (content: string) => boolean | Promise<boolean>;
    onCancel?: () => void;
    vimMode?: boolean;
    language?: string;
    // Context expansion options
    fullFileContent?: string; // Full file content for context expansion
    startLineInFile?: number; // 1-indexed line number of first line in editor
    endLineInFile?: number; // 1-indexed line number of last line in editor (exclusive)
    totalLines?: number; // Total lines in file
}

/**
 * GlintEditor - A wrapper around CodeMirror 6.
 * Decouples the editor implementation from the main application.
 */
class GlintEditor {
    private static vimCommandsRegistered = false;

    private container: HTMLElement;
    private options: GlintEditorOptions;
    private view: EditorView | null = null;
    private wrapper: HTMLElement | null = null;
    private currentStartLine: number;
    private currentEndLine: number;
    private expandTopButton: HTMLElement | null = null;
    private expandBottomButton: HTMLElement | null = null;

    constructor(container: HTMLElement, options: GlintEditorOptions = {}) {
        this.container = container;
        this.options = options;
        this.currentStartLine = options.startLineInFile || 1;
        this.currentEndLine = options.endLineInFile || (options.totalLines || 1);
        this.init();
    }

    private init() {
        // Create wrapper for editor and toolbar
        this.wrapper = document.createElement("div");
        this.wrapper.className = "glint-editor-wrapper";
        this.container.appendChild(this.wrapper);

        // Create expand top button if context expansion is enabled
        if (this.options.fullFileContent) {
            this.createExpandTopButton();
        }

        // Create editor container
        const editorContainer = document.createElement("div");
        editorContainer.className = "glint-editor-content";
        this.wrapper.appendChild(editorContainer);

        // Create expand bottom button if context expansion is enabled
        if (this.options.fullFileContent) {
            this.createExpandBottomButton();
        }

        // Create toolbar if save/cancel handlers provided
        if (this.options.onSave || this.options.onCancel) {
            this.createToolbar();
        }

        const extensions = [
            relativeLineNumbers(),
            highlightActiveLineGutter(),
            EditorView.lineWrapping,
            highlightSpecialChars(),
            history(),
            foldGutter(),
            drawSelection(),
            dropCursor(),
            EditorState.allowMultipleSelections.of(true),
            indentOnInput(),
            syntaxHighlighting(glintHighlightStyle),
            bracketMatching(),
            closeBrackets(),
            autocompletion({
                override: [emojiCompletionSource]
            }),
            highlightActiveLine(),
            highlightSelectionMatches(),
            keymap.of([
                ...closeBracketsKeymap,
                ...defaultKeymap,
                ...searchKeymap,
                ...historyKeymap,
                ...foldKeymap,
                ...completionKeymap,
                ...lintKeymap,
                indentWithTab,
                {
                    key: "Mod-s",
                    run: () => {
                        if (this.options.onSave) {
                            this.options.onSave(this.getValue());
                            return true;
                        }
                        return false;
                    }
                }
            ]),
            this.getLanguageExtension(),
            glintTheme,
            EditorView.theme({
                "&": {
                    height: this.options.height || "400px",
                    fontSize: "14px",
                    fontFamily: "'JetBrains Mono', 'Fira Code', 'IBM Plex Mono', monospace"
                }
            })
        ];

        if (this.options.vimMode) {
            extensions.push(vim({ status: true }));
        }

        const initialState = EditorState.create({
            doc: this.options.initialValue || "",
            extensions: extensions
        });

        this.view = new EditorView({
            state: initialState,
            parent: editorContainer
        });

        // 1. Auto-focus and Scroll
        this.view.focus();
        if (this.options.initialLine && this.options.initialLine > 0) {
            const lineNum = Math.min(this.options.initialLine, this.view.state.doc.lines);
            const line = this.view.state.doc.line(lineNum);
            this.view.dispatch({
                selection: { head: line.from, anchor: line.from },
                scrollIntoView: true
            });
        }

        // 2. Vim Custom Commands - Register globally only once to prevent memory leaks
        if (this.options.vimMode && !GlintEditor.vimCommandsRegistered) {
            GlintEditor.vimCommandsRegistered = true;

            // Helper to get current editor instance
            const getCurrentEditor = (): GlintEditor | null => (window as any).__glintCurrentEditor;

            const saveFn = async (): Promise<boolean> => {
                const editor = getCurrentEditor();
                if (editor?.options.onSave) {
                    return (await editor.options.onSave(editor.getValue())) ?? true;
                }
                return false;
            };

            Vim.defineEx("write", "w", saveFn);
            Vim.defineEx("Write", "W", saveFn);

            // Define :q for Cancel/Quit
            const quitFn = () => {
                const editor = getCurrentEditor();
                if (editor?.options.onCancel) {
                    editor.options.onCancel();
                }
            };

            Vim.defineEx("quit", "q", quitFn);
            Vim.defineEx("Quit", "Q", quitFn);

            const saveAndQuitFn = async () => {
                if (await saveFn()) quitFn();
            };

            Vim.defineEx("wq", "wq", saveAndQuitFn);
            Vim.defineEx("Wq", "Wq", saveAndQuitFn);
            Vim.defineEx("WQ", "WQ", saveAndQuitFn);
            Vim.defineEx("x", "x", saveAndQuitFn);
            Vim.defineEx("X", "X", saveAndQuitFn);

            // Define <Space>a to insert align environment
            Vim.defineAction("insertAlign", (cm: any) => {
                const alignTemplate = "$$\\begin{align*}\n\n\\end{align*}$$";
                const cursor = cm.getCursor();
                cm.replaceRange(alignTemplate, cursor);
                // Move cursor to the empty line inside the align block
                cm.setCursor({ line: cursor.line + 1, ch: 0 });
            });
            Vim.mapCommand("<Space>a", "action", "insertAlign", {}, { context: "normal" });

            // Define <Space>e to insert equation environment
            Vim.defineAction("insertEquation", (cm: any) => {
                const eqnTemplate = "$$\n\n$$";
                const cursor = cm.getCursor();
                cm.replaceRange(eqnTemplate, cursor);
                cm.setCursor({ line: cursor.line + 1, ch: 0 });
            });
            Vim.mapCommand("<Space>e", "action", "insertEquation", {}, { context: "normal" });

            // Define <Space>m for inline math
            Vim.defineAction("insertInlineMath", (cm: any) => {
                const cursor = cm.getCursor();
                cm.replaceRange("$$", cursor);
                cm.setCursor({ line: cursor.line, ch: cursor.ch + 1 });
            });
            Vim.mapCommand("<Space>m", "action", "insertInlineMath", {}, { context: "normal" });
        }

        // Track this editor as the current one for Vim commands when focused
        if (this.options.vimMode) {
            this.view.dom.addEventListener('focusin', () => {
                (window as any).__glintCurrentEditor = this;
            });
        }
    }

    private createExpandTopButton() {
        if (!this.wrapper) return;

        this.expandTopButton = document.createElement("button");
        this.expandTopButton.className = "glint-editor-expand-btn glint-editor-expand-top";
        this.expandTopButton.innerHTML = "↑ Show 10 more lines above";
        this.expandTopButton.onclick = () => this.expandContextAbove();
        this.wrapper.appendChild(this.expandTopButton);
        this.updateExpandButtonVisibility();
    }

    private createExpandBottomButton() {
        if (!this.wrapper) return;

        this.expandBottomButton = document.createElement("button");
        this.expandBottomButton.className = "glint-editor-expand-btn glint-editor-expand-bottom";
        this.expandBottomButton.innerHTML = "↓ Show 10 more lines below";
        this.expandBottomButton.onclick = () => this.expandContextBelow();
        this.wrapper.appendChild(this.expandBottomButton);
        this.updateExpandButtonVisibility();
    }

    private updateExpandButtonVisibility() {
        if (this.expandTopButton) {
            this.expandTopButton.style.display = this.currentStartLine > 1 ? 'block' : 'none';
        }
        if (this.expandBottomButton) {
            const totalLines = this.options.totalLines || 1;
            this.expandBottomButton.style.display = this.currentEndLine <= totalLines ? 'block' : 'none';
        }
    }

    private expandContextAbove() {
        if (!this.options.fullFileContent || !this.view) return;
        if (this.currentStartLine <= 1) return;

        const lines = this.options.fullFileContent.split('\n');
        const linesToAdd = 10;
        const newStartLine = Math.max(1, this.currentStartLine - linesToAdd);
        const actualLinesToAdd = this.currentStartLine - newStartLine;

        // Get the additional lines
        const additionalLines = lines.slice(newStartLine - 1, this.currentStartLine - 1);
        const currentContent = this.view.state.doc.toString();
        const newContent = additionalLines.join('\n') + '\n' + currentContent;

        // Get current cursor position
        const cursorPos = this.view.state.selection.main.head;

        // Calculate offset (number of characters added)
        const offset = additionalLines.join('\n').length + 1; // +1 for newline

        // Update the editor content
        this.view.dispatch({
            changes: { from: 0, to: this.view.state.doc.length, insert: newContent },
            selection: { head: cursorPos + offset, anchor: cursorPos + offset }
        });

        // Update tracking
        this.currentStartLine = newStartLine;
        this.updateExpandButtonVisibility();
    }

    private expandContextBelow() {
        if (!this.options.fullFileContent || !this.view) return;
        const totalLines = this.options.totalLines || 1;
        if (this.currentEndLine > totalLines) return;

        const lines = this.options.fullFileContent.split('\n');
        const linesToAdd = 10;
        const newEndLine = Math.min(totalLines + 1, this.currentEndLine + linesToAdd);

        // Get the additional lines (currentEndLine is exclusive, so we start from currentEndLine - 1)
        const additionalLines = lines.slice(this.currentEndLine - 1, newEndLine - 1);
        const currentContent = this.view.state.doc.toString();
        const newContent = currentContent + '\n' + additionalLines.join('\n');

        // Keep cursor position (it shouldn't move when adding below)
        const cursorPos = this.view.state.selection.main.head;

        // Update the editor content
        this.view.dispatch({
            changes: { from: 0, to: this.view.state.doc.length, insert: newContent },
            selection: { head: cursorPos, anchor: cursorPos }
        });

        // Update tracking
        this.currentEndLine = newEndLine;
        this.updateExpandButtonVisibility();
    }

    private getLanguageExtension() {
        switch (this.options.language?.toLowerCase()) {
            case 'js':
            case 'javascript':
            case 'typescript':
            case 'ts':
                return javascript({ typescript: true });
            case 'py':
            case 'python':
                return python();
            case 'html':
                return html();
            case 'css':
                return css();
            default:
                return createMarkdownWithNesting();
        }
    }

    private createToolbar() {
        if (!this.wrapper) return;

        const toolbar = document.createElement("div");
        toolbar.className = "glint-editor-toolbar";

        if (this.options.onSave) {
            const saveBtn = document.createElement("button");
            saveBtn.className = "glint-btn glint-btn-save";
            saveBtn.innerHTML = "Save";
            saveBtn.onclick = () => this.options.onSave!(this.getValue());
            toolbar.appendChild(saveBtn);
        }

        if (this.options.onCancel) {
            const cancelBtn = document.createElement("button");
            cancelBtn.className = "glint-btn glint-btn-cancel";
            cancelBtn.innerHTML = "Cancel";
            cancelBtn.onclick = () => this.options.onCancel!();
            toolbar.appendChild(cancelBtn);
        }

        this.wrapper.appendChild(toolbar);
    }

    public getValue(): string {
        return this.view ? this.view.state.doc.toString() : "";
    }

    public setValue(value: string) {
        if (this.view) {
            this.view.dispatch({
                changes: { from: 0, to: this.view.state.doc.length, insert: value }
            });
        }
    }

    public destroy() {
        // Clear global reference if this was the current editor
        if ((window as any).__glintCurrentEditor === this) {
            (window as any).__glintCurrentEditor = null;
        }

        if (this.view) {
            this.view.destroy();
            this.view = null;
        }
        if (this.wrapper) {
            this.wrapper.remove();
            this.wrapper = null;
        }
    }
}

// Expose to global scope for use in the browser
(window as any).GlintEditor = GlintEditor;

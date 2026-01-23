/**
 * Global type extensions for Glint client-side modules.
 * Shared across editor-sessions.ts, editor-integration.ts, etc.
 */

/**
 * Options for GlintEditor initialization.
 */
export interface GlintEditorOptions {
    initialValue?: string;
    initialLine?: number; // 1-indexed line to scroll to on load
    height?: string;
    onSave?: (content: string) => void;
    onCancel?: () => void;
    vimMode?: boolean;
    language?: string;
    fullFileContent?: string; // Full file content for context expansion
    startLineInFile?: number; // 1-indexed line number of first line in editor
    endLineInFile?: number; // 1-indexed line number of last line in editor (exclusive)
    totalLines?: number; // Total lines in file
}

/**
 * GlintEditor instance interface.
 */
export interface GlintEditorInstance {
    getValue(): string;
    setValue(value: string): void;
    destroy(): void;
    currentStartLine?: number;
    currentEndLine?: number;
}

declare global {
    interface Window {
        /** True when an inline editor is active */
        __glintEditingActive?: boolean;
        /** True when a reload is pending but suppressed */
        __glintPendingReload?: boolean;
        /** Current active editor instance for Vim commands */
        __glintCurrentEditor?: GlintEditorInstance;
    }

    /**
     * GlintEditor constructor available globally from editor.bundle.js
     */
    const GlintEditor: {
        new (container: HTMLElement, options?: GlintEditorOptions): GlintEditorInstance;
    };
}

// Ensure this file is treated as a module
export { };

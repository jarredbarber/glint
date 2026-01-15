/**
 * Global type extensions for Glint client-side modules.
 * Shared across editor-sessions.ts, editor-integration.ts, etc.
 */

declare global {
    interface Window {
        /** True when an inline editor is active */
        __glintEditingActive?: boolean;
        /** True when a reload is pending but suppressed */
        __glintPendingReload?: boolean;
    }
}

// Ensure this file is treated as a module
export { };

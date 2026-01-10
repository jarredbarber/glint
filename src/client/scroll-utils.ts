/**
 * Shared utilities for preserving scroll position across reloads
 * and managing SSE hot-reload suppression.
 */

/**
 * Saves the current scroll position of the content area to sessionStorage.
 * Used before operations that trigger a page reload/update (like saving content).
 */
export function saveScrollPosition(): void {
    const contentEl = document.querySelector('.content') || document.querySelector('main');
    if (contentEl) {
        sessionStorage.setItem('glint-scroll-y', String((contentEl as HTMLElement).scrollTop));
    }
}

/**
 * Sets a flag to suppress the next SSE hot-reload.
 * Useful when the client initiates a save and manually handles the UI update/reload,
 * preventing a redundant reload from the server's file watcher event.
 */
export function suppressSSEReload(): void {
    sessionStorage.setItem('glint-suppress-reload', Date.now().toString());
}

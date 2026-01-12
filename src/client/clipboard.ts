
/**
 * Clipboard Utilities
 */

import { canEdit } from './permissions.js';

let hasClipboardImage = false;

export function getHasClipboardImage(): boolean {
    if (!canEdit()) return false;
    return hasClipboardImage;
}

export async function checkClipboardForImage(): Promise<boolean> {
    if (typeof navigator.clipboard === 'undefined') return false;

    try {
        // Permissions API check
        // Note: some browsers might not support 'clipboard-read' in query
        const status = await navigator.permissions.query({ name: "clipboard-read" as any });
        if (status.state === 'granted') {
            const items = await navigator.clipboard.read();
            let foundImage = false;
            for (const item of items) {
                if (item.types.some(type => type.startsWith('image/'))) {
                    foundImage = true;
                    break;
                }
            }
            hasClipboardImage = foundImage;
            return foundImage;
        } else {
            hasClipboardImage = false;
            return false;
        }
    } catch (e) {
        hasClipboardImage = false;
        return false;
    }
}

export function setupClipboardListeners(onUpdate: (found: boolean) => void) {
    if (!canEdit()) return;
    const handler = async () => {
        const found = await checkClipboardForImage();
        onUpdate(found);
    };

    window.addEventListener('focus', handler);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') handler();
    });

    document.querySelector('.content-wrapper')?.addEventListener('mouseenter', handler);

    // Initial check
    handler();
}

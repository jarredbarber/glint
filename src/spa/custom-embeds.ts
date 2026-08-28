const MIN_EMBED_WIDTH = 160;
const MAX_EMBED_WIDTH = 1600;
const MIN_EMBED_HEIGHT = 96;
const MAX_EMBED_HEIGHT = 2048;

const initializedFrames = new WeakSet<HTMLIFrameElement>();
const activeFrames = new Set<HTMLIFrameElement>();
let resizeListenerInstalled = false;

export interface EmbedSize {
    width: number;
    height: number;
}

export function boundedEmbedSize(message: unknown): EmbedSize | null {
    if (!message || typeof message !== 'object') return null;
    const value = message as Record<string, unknown>;
    if (value.type !== 'glint-embed-resize') return null;
    if (Object.keys(value).some((key) => key !== 'type' && key !== 'width' && key !== 'height')) return null;
    if (typeof value.width !== 'number' || !Number.isFinite(value.width)) return null;
    if (typeof value.height !== 'number' || !Number.isFinite(value.height)) return null;
    return {
        width: Math.max(MIN_EMBED_WIDTH, Math.min(MAX_EMBED_WIDTH, Math.round(value.width))),
        height: Math.max(MIN_EMBED_HEIGHT, Math.min(MAX_EMBED_HEIGHT, Math.round(value.height))),
    };
}

function installResizeListener(): void {
    if (resizeListenerInstalled) return;
    resizeListenerInstalled = true;
    window.addEventListener('message', (event) => {
        const size = boundedEmbedSize(event.data);
        if (!size) return;
        for (const frame of activeFrames) {
            if (!frame.isConnected) {
                activeFrames.delete(frame);
                continue;
            }
            if (frame.contentWindow !== event.source) continue;
            frame.style.width = `${size.width}px`;
            frame.style.height = `${size.height}px`;
            frame.style.maxWidth = '100%';
            return;
        }
    });
}

function initializeFrame(frame: HTMLIFrameElement, encodedFragment: string): void {
    let fragment: string;
    try {
        fragment = decodeURIComponent(encodedFragment);
    } catch {
        frame.remove();
        return;
    }

    frame.removeAttribute('data-glint-embed');
    frame.addEventListener('load', () => {
        const child = frame.contentWindow;
        if (!child) return;
        const channel = new MessageChannel();
        child.postMessage('glint-embed-init', '*', [channel.port2]);
        channel.port1.postMessage(fragment);
        channel.port1.close();
    }, { once: true });
    frame.src = './embed-host.html';
    activeFrames.add(frame);
}

/** Initialize renderer-owned custom embed frames under a newly rendered subtree. */
export function wireCustomEmbeds(root: ParentNode): void {
    installResizeListener();
    for (const frame of root.querySelectorAll<HTMLIFrameElement>('iframe.glint-custom-embed[data-glint-embed]')) {
        if (initializedFrames.has(frame)) continue;
        initializedFrames.add(frame);
        initializeFrame(frame, frame.getAttribute('data-glint-embed') ?? '');
    }
}

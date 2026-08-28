import { parseFragment, serialize, type DefaultTreeAdapterTypes } from 'parse5';

const REMOTE_URL = /^(?:https?:)?\/\//i;
const MEDIA_ATTRIBUTES: Record<string, ReadonlySet<string>> = {
    audio: new Set(['src']),
    img: new Set(['src']),
    source: new Set(['src']),
    track: new Set(['src']),
    video: new Set(['src', 'poster']),
};

function isElement(node: DefaultTreeAdapterTypes.Node): node is DefaultTreeAdapterTypes.Element {
    return 'tagName' in node;
}

function walkMedia(html: string, remove: boolean): { html: string; count: number } {
    const fragment = parseFragment(html);
    let count = 0;
    const visit = (node: DefaultTreeAdapterTypes.Node): void => {
        if (!isElement(node)) return;
        const mediaAttributes = MEDIA_ATTRIBUTES[node.tagName];
        if (mediaAttributes) {
            node.attrs = node.attrs.filter((attribute) => {
                if (!mediaAttributes.has(attribute.name) || !REMOTE_URL.test(attribute.value.trim())) return true;
                count += 1;
                return !remove;
            });
        }
        if (node.tagName === 'iframe' && node.attrs.some((attribute) =>
            attribute.name === 'class' && attribute.value.split(/\s+/).includes('glint-custom-embed'))) {
            const before = node.attrs.length;
            node.attrs = node.attrs.filter((attribute) => attribute.name !== 'srcdoc');
            if (node.attrs.length !== before) count += 1;
        }
        for (const child of node.childNodes) visit(child);
    };
    for (const child of fragment.childNodes) visit(child);
    return { html: remove ? serialize(fragment) : html, count };
}

export function countRemoteMedia(html: string): number {
    return walkMedia(html, false).count;
}

export function applyExportMediaPolicy(html: string, allowRemoteMedia = false): string {
    return allowRemoteMedia ? html : walkMedia(html, true).html;
}

export function portableContentSecurityPolicy(allowRemoteMedia = false): string {
    const remote = allowRemoteMedia ? ' http: https:' : '';
    return `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:${remote}; media-src data:${remote}; font-src data:; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'`;
}

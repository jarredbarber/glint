import {
    parseFragment,
    Tokenizer,
    type DefaultTreeAdapterTypes,
    type ParserError,
    type TokenHandler,
} from 'parse5';
import rehypeRaw from 'rehype-raw';
import type { Element, Root, Text } from 'hast';
import type { Node, Parent } from 'unist';
import { visit } from 'unist-util-visit';
import type { VFile } from 'vfile';

export type CustomEmbedMode = 'portable' | 'spa';

interface RawRange {
    start: number;
    end: number;
}

interface CustomEmbedNode extends Node {
    type: 'glintCustomEmbed';
    value: string;
}

const rawRangesKey = Symbol('glintAuthorHtmlRanges');

const PASSIVE_ELEMENTS: Record<string, true> = {
    a: true, abbr: true, address: true, article: true, aside: true, audio: true,
    b: true, bdi: true, bdo: true, blockquote: true, br: true, caption: true,
    cite: true, code: true, col: true, colgroup: true, data: true, dd: true,
    del: true, details: true, dfn: true, div: true, dl: true, dt: true, em: true,
    figcaption: true, figure: true, footer: true, h1: true, h2: true, h3: true,
    h4: true, h5: true, h6: true, header: true, hgroup: true, hr: true, i: true,
    img: true, ins: true, kbd: true, li: true, main: true, mark: true, nav: true,
    ol: true, p: true, picture: true, pre: true, q: true, rp: true, rt: true,
    ruby: true, s: true, samp: true, section: true, small: true, source: true,
    span: true, strong: true, sub: true, summary: true, sup: true, table: true,
    tbody: true, td: true, tfoot: true, th: true, thead: true, time: true,
    tr: true, track: true, u: true, ul: true, var: true, video: true, wbr: true,
};

const VOID_ELEMENTS: Record<string, true> = {
    area: true, base: true, basefont: true, bgsound: true, br: true, col: true,
    embed: true, frame: true, hr: true, img: true, input: true, keygen: true,
    link: true, meta: true, param: true, source: true, track: true, wbr: true,
};

type AttributeLookup = Record<string, true>;
const NO_ATTRIBUTES: AttributeLookup = {};
const GLOBAL_ATTRIBUTES: AttributeLookup = { title: true, lang: true, dir: true };
const ELEMENT_ATTRIBUTES: Record<string, AttributeLookup> = {
    a: { href: true, target: true, rel: true },
    audio: { src: true, controls: true, loop: true, muted: true, preload: true },
    blockquote: { cite: true },
    col: { span: true },
    colgroup: { span: true },
    data: { value: true },
    del: { cite: true, dateTime: true },
    details: { open: true, name: true },
    figure: { className: true, align: true },
    img: {
        src: true, alt: true, width: true, height: true, loading: true,
        decoding: true, className: true, align: true,
    },
    ins: { cite: true, dateTime: true },
    li: { value: true },
    ol: { start: true, reversed: true, type: true },
    q: { cite: true },
    source: { src: true, type: true, media: true },
    td: { colSpan: true, rowSpan: true, headers: true },
    th: { colSpan: true, rowSpan: true, headers: true, scope: true, abbr: true },
    time: { dateTime: true },
    track: { kind: true, src: true, srcLang: true, label: true, default: true },
    video: {
        src: true, poster: true, controls: true, loop: true, muted: true,
        playsInline: true, preload: true, width: true, height: true,
    },
};

const BOOLEAN_ATTRIBUTES: AttributeLookup = {
    controls: true, default: true, loop: true, muted: true, open: true,
    playsInline: true, reversed: true,
};
const ALIGNMENTS: AttributeLookup = { left: true, center: true, right: true };
const ALIGNMENT_CLASSES: AttributeLookup = {
    'align-left': true,
    'align-center': true,
    'align-right': true,
};
const EMBED_CSP = "default-src 'none'; script-src https: 'unsafe-inline'; style-src https: 'unsafe-inline'; img-src https: data: blob:; media-src https: blob:; font-src https: data:; connect-src https:; frame-src https:; object-src 'none'; base-uri 'none'; form-action 'none'";
const EMBED_SANDBOX = ['allow-scripts', 'allow-presentation'];

function childElements(node: DefaultTreeAdapterTypes.ParentNode): DefaultTreeAdapterTypes.Element[] {
    const result: DefaultTreeAdapterTypes.Element[] = [];
    for (const child of node.childNodes) {
        if ('tagName' in child) {
            result.push(child);
            result.push(...childElements(child));
        }
    }
    return result;
}

function tagNames(value: string): string[] {
    const names: string[] = [];
    const handler: TokenHandler = {
        onStartTag: (token) => names.push(token.tagName),
        onEndTag: (token) => names.push(token.tagName),
        onComment: () => undefined,
        onDoctype: () => undefined,
        onEof: () => undefined,
        onCharacter: () => undefined,
        onNullCharacter: () => undefined,
        onWhitespaceCharacter: () => undefined,
    };
    new Tokenizer({}, handler).write(value, true);
    return names;
}

function inspectFragment(value: string): { hasUnknown: boolean; complete: boolean } {
    const errors: ParserError[] = [];
    const fragment = parseFragment(value, {
        sourceCodeLocationInfo: true,
        onParseError: (error) => errors.push(error),
    });
    const elements = childElements(fragment);
    const hasUnknown = tagNames(value).some((tagName) => !PASSIVE_ELEMENTS[tagName]);
    const complete = errors.length === 0 && elements.every((element) => {
        if (VOID_ELEMENTS[element.tagName]) return true;
        return Boolean(element.sourceCodeLocation?.startTag && element.sourceCodeLocation.endTag);
    });
    return { hasUnknown, complete };
}

function rawRange(node: Node): RawRange | null {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    return typeof start === 'number' && typeof end === 'number' ? { start, end } : null;
}

/** Classify author HTML before the HTML parser can merge it with trusted renderer output. */
export function rehypeClassifyAuthorHtml() {
    return (tree: Root, file: VFile) => {
        const ranges: RawRange[] = [];
        visit(tree, 'raw', (node: Node & { value: string }, index, parent) => {
            if (!parent || index === undefined) return;
            const range = rawRange(node);
            const { hasUnknown, complete } = inspectFragment(node.value);

            if (hasUnknown) {
                if (parent.type === 'root' && complete) {
                    (parent as Parent).children[index] = {
                        type: 'glintCustomEmbed',
                        value: node.value,
                        position: node.position,
                    } as CustomEmbedNode;
                } else {
                    (parent as Parent).children[index] = {
                        type: 'text',
                        value: node.value,
                        position: node.position,
                    } as Text;
                }
                return;
            }

            if (range) ranges.push(range);
        });
        (file.data as Record<PropertyKey, unknown>)[rawRangesKey] = ranges;
    };
}

function startsInRawRange(node: Element, ranges: RawRange[]): boolean {
    const offset = node.position?.start.offset;
    return typeof offset === 'number' && ranges.some((range) => offset >= range.start && offset < range.end);
}

function allowedUrl(value: unknown, kind: 'link' | 'media' | 'image'): string | undefined {
    if (typeof value !== 'string') return undefined;
    const url = value.trim();
    if (!url) return undefined;
    const schemeProbe = url.replace(/[\u0000-\u0020\u007f]+/g, '');
    const scheme = /^([a-z][a-z\d+.-]*):/i.exec(schemeProbe)?.[1]?.toLowerCase();
    if (!scheme) return url;
    if (scheme === 'http' || scheme === 'https') return url;
    if (kind === 'link' && (scheme === 'mailto' || scheme === 'tel')) return url;
    if (kind === 'image' && /^data:image\/(?:png|jpeg|gif|webp|avif);base64,/i.test(url)) return url;
    return undefined;
}

function boundedDimension(value: unknown, allowPercent = false): number | string | undefined {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 4096) return value;
    if (typeof value !== 'string') return undefined;
    if (/^\d{1,4}$/.test(value)) {
        const number = Number(value);
        return number >= 1 && number <= 4096 ? number : undefined;
    }
    if (allowPercent && /^\d{1,3}%$/.test(value)) {
        const number = Number(value.slice(0, -1));
        return number >= 1 && number <= 100 ? value : undefined;
    }
    return undefined;
}

function sanitizeProperties(node: Element): void {
    const original = node.properties ?? {};
    const allowedForElement = ELEMENT_ATTRIBUTES[node.tagName] ?? NO_ATTRIBUTES;
    const properties: Element['properties'] = {};

    for (const [name, value] of Object.entries(original)) {
        if (!GLOBAL_ATTRIBUTES[name] && !allowedForElement[name]) continue;
        if (BOOLEAN_ATTRIBUTES[name]) {
            if (value) properties[name] = true;
            continue;
        }
        if (name === 'dir') {
            if (value === 'ltr' || value === 'rtl' || value === 'auto') properties[name] = value;
            continue;
        }
        if (name === 'href' || name === 'cite') {
            const url = allowedUrl(value, 'link');
            if (url) properties[name] = url;
            continue;
        }
        if (name === 'src' || name === 'poster') {
            const kind = node.tagName === 'img' || name === 'poster' ? 'image' : 'media';
            const url = allowedUrl(value, kind);
            if (url) properties[name] = url;
            continue;
        }
        if (name === 'width' || name === 'height') {
            const dimension = boundedDimension(value, node.tagName === 'img' && name === 'width');
            if (dimension !== undefined) properties[name] = dimension;
            continue;
        }
        if (name === 'className') {
            const classes = (Array.isArray(value) ? value : [value])
                .filter((item): item is string => typeof item === 'string' && Boolean(ALIGNMENT_CLASSES[item]));
            if (classes.length) properties.className = classes;
            continue;
        }
        if (name === 'align') {
            if (typeof value === 'string' && ALIGNMENTS[value.toLowerCase()]) {
                const classes = Array.isArray(properties.className) ? properties.className : [];
                properties.className = [...classes, `align-${value.toLowerCase()}`];
            }
            continue;
        }
        if (name === 'target') {
            if (value === '_blank') properties.target = '_blank';
            continue;
        }
        if (name === 'rel') continue;
        if (typeof value === 'string' || typeof value === 'number') properties[name] = value;
    }

    if (properties.target === '_blank') properties.rel = ['noopener', 'noreferrer'];
    node.properties = properties;
}

/** Sanitize only elements proven to originate in author raw HTML. */
export function rehypeSanitizeAuthorHtml() {
    return (tree: Root, file: VFile) => {
        const ranges = ((file.data as Record<PropertyKey, unknown>)[rawRangesKey] as RawRange[] | undefined) ?? [];
        visit(tree, 'element', (node: Element) => {
            if (startsInRawRange(node, ranges)) sanitizeProperties(node);
        });
    };
}

function portableSrcdoc(fragment: string): string {
    return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${EMBED_CSP}"><meta name="viewport" content="width=device-width,initial-scale=1">${fragment}`;
}

function createEmbedElement(node: CustomEmbedNode, mode: CustomEmbedMode): Element {
    const properties: Element['properties'] = {
        className: ['glint-custom-embed'],
        sandbox: EMBED_SANDBOX,
        title: 'Embedded custom content',
        loading: 'lazy',
    };
    if (mode === 'spa') {
        properties['data-glint-embed'] = encodeURIComponent(node.value);
    } else {
        properties.srcDoc = portableSrcdoc(node.value);
    }
    return { type: 'element', tagName: 'iframe', properties, children: [], position: node.position };
}

/** Materialize internally classified custom blocks only after author sanitization. */
export function rehypeCustomEmbeds(mode: CustomEmbedMode) {
    return (tree: Root) => {
        visit(tree, 'glintCustomEmbed', (node: CustomEmbedNode, index, parent) => {
            if (!parent || index === undefined) return;
            (parent as Parent).children[index] = createEmbedElement(node, mode) as unknown as Node;
        });
    };
}

export const rawHtmlOptions = { passThrough: ['glintCustomEmbed'] } satisfies Parameters<typeof rehypeRaw>[0];

import { Discussion, DiscussionAnchor } from './storage/types.js';

export type ResolvedDiscussion = { discussion: Discussion; sourceLine: number | null };

function parsedAnchor(anchor: DiscussionAnchor | null): DiscussionAnchor | null {
    return anchor && anchor.version === 1 && Number.isInteger(anchor.sourceLine) && anchor.sourceLine > 0 && typeof anchor.quote === 'string' ? anchor : null;
}

function matches(lines: string[], anchor: DiscussionAnchor): number[] {
    const matches: number[] = [];
    for (let index = 0; index < lines.length; index += 1) {
        if (lines[index] === anchor.quote) matches.push(index + 1);
    }
    return matches;
}

export function resolveDiscussionAnchors(content: string, discussions: Discussion[]): ResolvedDiscussion[] {
    const lines = content.split('\n');
    return discussions.map((discussion) => {
        const anchor = parsedAnchor(discussion.anchor);
        if (!anchor) return { discussion, sourceLine: null };
        if (lines[anchor.sourceLine - 1] === anchor.quote) return { discussion, sourceLine: anchor.sourceLine };
        const candidates = matches(lines, anchor);
        const context = candidates.filter((line) => lines[line - 2] === anchor.before && lines[line] === anchor.after);
        if (context.length === 1) return { discussion, sourceLine: context[0] };
        if (candidates.length === 1) return { discussion, sourceLine: candidates[0] };
        return { discussion, sourceLine: null };
    });
}

export function anchorFromElement(element: HTMLElement, content: string): DiscussionAnchor | null {
    const sourceLine = Number(element.dataset.sourceLine);
    if (!Number.isInteger(sourceLine) || sourceLine < 1) return null;
    const lines = content.split('\n');
    const quote = lines[sourceLine - 1];
    if (quote === undefined) return null;
    return { version: 1, sourceLine, quote, before: lines[sourceLine - 2] ?? null, after: lines[sourceLine] ?? null };
}

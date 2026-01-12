import { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';
import { emojiList } from './emoji-data.js';

/**
 * Emoji completion source for CodeMirror 6
 * Triggers on :emoji_name: pattern
 */
export function emojiCompletionSource(context: CompletionContext): CompletionResult | null {
    const word = context.matchBefore(/:\w*/);

    if (!word || (word.from === word.to && !context.explicit)) {
        return null;
    }

    const query = word.text.slice(1).toLowerCase();
    const options: Completion[] = [];
    const seen = new Set<string>();

    for (const item of emojiList) {
        const nameMatch = item.name.toLowerCase().includes(query);
        const aliasMatch = item.aliases.some(a => a.toLowerCase().includes(query));

        if ((nameMatch || aliasMatch) && !seen.has(item.emoji)) {
            seen.add(item.emoji);
            options.push({
                label: `${item.emoji} :${item.name}:`,
                apply: item.emoji,
                type: 'text',
                detail: item.aliases.length ? item.aliases.join(', ') : undefined,
            });
        }
    }

    return {
        from: word.from,
        options: options.slice(0, 30),
        filter: false
    };
}

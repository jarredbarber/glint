/**
 * Emoji Data for Autocomplete
 */
export interface EmojiItem {
    name: string;
    emoji: string;
    aliases: string[];
}

export const emojiList: EmojiItem[] = [
    // Smileys
    { name: 'smile', emoji: '😊', aliases: ['happy'] },
    { name: 'grin', emoji: '😁', aliases: [] },
    { name: 'joy', emoji: '😂', aliases: ['lol', 'laugh'] },
    { name: 'rofl', emoji: '🤣', aliases: [] },
    { name: 'heart_eyes', emoji: '😍', aliases: ['love'] },
    { name: 'wink', emoji: '😉', aliases: [] },
    { name: 'thinking', emoji: '🤔', aliases: ['hmm'] },
    { name: 'sweat', emoji: '😅', aliases: [] },
    { name: 'cry', emoji: '😢', aliases: ['sad'] },
    { name: 'sob', emoji: '😭', aliases: [] },
    { name: 'angry', emoji: '😠', aliases: ['mad'] },
    { name: 'rage', emoji: '😡', aliases: [] },
    { name: 'sunglasses', emoji: '😎', aliases: ['cool'] },
    { name: 'nerd', emoji: '🤓', aliases: [] },
    { name: 'skull', emoji: '💀', aliases: ['dead'] },
    // Gestures
    { name: 'wave', emoji: '👋', aliases: ['hi', 'bye'] },
    { name: 'ok_hand', emoji: '👌', aliases: ['ok'] },
    { name: 'thumbsup', emoji: '👍', aliases: ['+1', 'like'] },
    { name: 'thumbsdown', emoji: '👎', aliases: ['-1'] },
    { name: 'clap', emoji: '👏', aliases: ['applause'] },
    { name: 'pray', emoji: '🙏', aliases: ['thanks'] },
    { name: 'muscle', emoji: '💪', aliases: ['strong'] },
    // Hearts & Symbols
    { name: 'heart', emoji: '❤️', aliases: ['love'] },
    { name: 'fire', emoji: '🔥', aliases: ['hot'] },
    { name: 'sparkles', emoji: '✨', aliases: ['shine'] },
    { name: 'star', emoji: '⭐', aliases: [] },
    { name: 'zap', emoji: '⚡', aliases: ['lightning'] },
    { name: 'boom', emoji: '💥', aliases: ['explosion'] },
    { name: 'rocket', emoji: '🚀', aliases: [] },
    { name: 'check', emoji: '✅', aliases: ['done'] },
    { name: 'x', emoji: '❌', aliases: ['no', 'cross'] },
    { name: 'warning', emoji: '⚠️', aliases: ['alert'] },
    { name: 'question', emoji: '❓', aliases: [] },
    { name: 'exclamation', emoji: '❗', aliases: [] },
    { name: 'bulb', emoji: '💡', aliases: ['idea'] },
    { name: 'lock', emoji: '🔒', aliases: [] },
    { name: 'key', emoji: '🔑', aliases: [] },
    { name: 'link', emoji: '🔗', aliases: [] },
    // Objects
    { name: 'memo', emoji: '📝', aliases: ['note'] },
    { name: 'book', emoji: '📖', aliases: [] },
    { name: 'calendar', emoji: '📅', aliases: ['date'] },
    { name: 'clock', emoji: '🕐', aliases: ['time'] },
    { name: 'email', emoji: '📧', aliases: ['mail'] },
    { name: 'computer', emoji: '💻', aliases: ['laptop'] },
    { name: 'bug', emoji: '🐛', aliases: [] },
    { name: 'gear', emoji: '⚙️', aliases: ['settings'] },
    { name: 'wrench', emoji: '🔧', aliases: ['tool'] },
    // Nature
    { name: 'sun', emoji: '☀️', aliases: [] },
    { name: 'cloud', emoji: '☁️', aliases: [] },
    { name: 'rainbow', emoji: '🌈', aliases: [] },
    { name: 'earth', emoji: '🌎', aliases: ['world'] },
    // Activities
    { name: 'trophy', emoji: '🏆', aliases: ['winner'] },
    { name: 'tada', emoji: '🎉', aliases: ['party'] },
    { name: 'gift', emoji: '🎁', aliases: ['present'] },
    { name: 'art', emoji: '🎨', aliases: ['paint'] },
    // Food
    { name: 'coffee', emoji: '☕', aliases: [] },
    { name: 'pizza', emoji: '🍕', aliases: [] },
    { name: 'beer', emoji: '🍺', aliases: [] },
];

export const emojiMap: Record<string, string> = {};
for (const item of emojiList) {
    emojiMap[item.name] = item.emoji;
    for (const alias of item.aliases) {
        emojiMap[alias] = item.emoji;
    }
}

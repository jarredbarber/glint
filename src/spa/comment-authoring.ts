export function normalizeCommentAuthor(name: string): string {
    return name.trim().replace(/\s+/g, '-').replace(/@/g, '-').replace(/[^\w.-]/g, '') || 'anonymous';
}

export function formatCommentEntry(author: string, message: string, date = new Date()): string {
    const timestamp = date.toISOString().slice(0, 16).replace('T', ':');
    return `${normalizeCommentAuthor(author)}@${timestamp} ${message.trim()}`;
}

export function appendCommentBlock(content: string, entry: string): string {
    const prefix = content.trimEnd();
    return `${prefix}${prefix ? '\n\n' : ''}\`\`\`comment\n${entry}\n\`\`\`\n`;
}

/** Append a reply before the closing fence of the comment block at sourceLine. */
export function appendCommentReply(content: string, sourceLine: number, entry: string): string {
    const lines = content.split('\n');
    let start = Math.max(0, sourceLine - 1);
    while (start < lines.length && !/^```comment\s*$/.test(lines[start]!)) start += 1;
    if (start === lines.length) throw new Error('Comment block no longer exists. Refresh and try again.');

    let end = start + 1;
    while (end < lines.length && !/^```\s*$/.test(lines[end]!)) end += 1;
    if (end === lines.length) throw new Error('Comment block is missing its closing fence.');

    lines.splice(end, 0, entry);
    return lines.join('\n');
}

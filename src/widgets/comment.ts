import { visit } from 'unist-util-visit';
import type { Node, Parent } from 'unist';
import type { VisitorResult } from 'unist-util-visit';
import type { WidgetHandler } from './types.js';

const CONTINUE = undefined; // unist-util-visit expects undefined to continue

interface CodeNode extends Node {
    type: 'code';
    lang?: string;
    value: string;
    data?: any;
}

export const commentHandler: WidgetHandler = {
    match: (node: Node): boolean => {
        return node.type === 'code' && (node as CodeNode).lang === 'comment';
    },

    transform: (node: Node, index: number | undefined, parent: Parent | undefined): VisitorResult => {
        const codeNode = node as CodeNode;
        const lines = codeNode.value.split('\n');

        let isResolved = false;
        let isImportant = false;
        const messages: { author: string; date: string; time: string; content: string }[] = [];

        // Parse flags and messages
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            if (trimmed === '#resolved') {
                isResolved = true;
                continue;
            }
            if (trimmed === '#important') {
                isImportant = true;
                continue;
            }

            // Parse message: author@YYYY-MM-DD:HH:MM message
            const match = trimmed.match(/^(@?[\w-]+)@(\d{4}-\d{2}-\d{2})(?::(\d{2}:\d{2}))?\s+(.*)$/);

            if (match) {
                const [, author, date, time, content] = match;
                messages.push({
                    author: author.replace(/^@/, ''),
                    date,
                    time: time || '',
                    content
                });
            } else {
                if (messages.length > 0) {
                    messages[messages.length - 1].content += '\n' + trimmed;
                } else {
                    messages.push({ author: 'system', date: '', time: '', content: trimmed });
                }
            }
        }

        // Build HTML string
        // Apply offset to get original file line (codeNode.position is relative to processed content)
        const offset = (codeNode.data as any)?.sourceLineOffset || 0;
        const processedLine = codeNode.position?.start.line || 1;
        const sourceLine = processedLine + offset;
        const dataAttrs = `data-resolved="${isResolved}" data-important="${isImportant}" data-source-line="${sourceLine}"`;

        let html = `<div class="glint-widget glint-comment" ${dataAttrs}>`;

        // Header
        if (isResolved) {
            html += `<div class="glint-comment-header">✓ Resolved</div>`;
        } else if (isImportant) {
            html += `<div class="glint-comment-header important">❗ Important</div>`;
        }

        // Thread
        html += `<div class="glint-comment-thread">`;
        for (const msg of messages) {
            const timestamp = msg.time ? `${msg.date} ${msg.time}` : msg.date;
            html += `<div class="glint-comment-item">`;
            html += `<div class="comment-meta"><span class="comment-author">${msg.author}</span><span class="comment-date"> · ${timestamp}</span></div>`;
            html += `<div class="comment-content">${msg.content}</div>`;
            html += `</div>`;
        }
        html += `</div>`;

        // Actions
        html += `<div class="glint-comment-actions">`;
        html += `<button class="glint-btn btn-reply" title="Reply">Reply</button>`;
        if (!isResolved) {
            html += `<button class="glint-btn btn-resolve" title="Resolve thread">Resolve</button>`;
        }
        html += `</div>`;

        html += `</div>`;

        // Replace with MDAST html node (rehype-raw will parse it)
        if (parent && index !== undefined) {
            (parent.children as any[])[index] = {
                type: 'html',
                value: html
            };
        }

        return CONTINUE;
    },

    getLLMInstructions: () => `
### Comments
- Syntax:
\`\`\`comment
#resolved (optional flag)
user@YYYY-MM-DD:HH:MM Message text...
reply_user@YYYY-MM-DD:HH:MM Reply text...
\`\`\`
- Flags: \`#resolved\` (collapsed), \`#important\` (red border)
`
};

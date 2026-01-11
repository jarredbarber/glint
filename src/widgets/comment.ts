import { visit } from 'unist-util-visit';
import type { Node, Parent } from 'unist';
import type { VisitorResult } from 'unist-util-visit';
import type { WidgetHandler } from './types.js';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';

import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

const CONTINUE = undefined; // unist-util-visit expects undefined to continue

// Simple sync processor for comment bodies (Markdown -> HTML)
const bodyProcessor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeHighlight)
    .use(rehypeStringify);

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
        let summaryText = '';
        const messages: { author: string; date: string; time: string; content: string }[] = [];

        // Parse flags and messages
        for (const line of lines) {
            const trimmed = line.trim();

            if (trimmed === '#resolved') {
                isResolved = true;
                continue;
            }
            if (trimmed === '#important') {
                isImportant = true;
                continue;
            }
            if (trimmed.startsWith('summary:')) {
                summaryText = trimmed.substring(8).trim();
                continue;
            }

            // author@YYYY-MM-DD[:HH:MM] message
            const match = trimmed.match(/^(@?[\w\.-]+)@(\d{4}-\d{2}-\d{2})(?::(\d{2}:\d{2}))?\s+(.*)$/);
            if (match) {
                const [, author, date, time, content] = match;
                messages.push({ author, date, time: time || '', content });
            } else if (messages.length > 0) {
                // Continuation line or initial empty line after header
                // If it's the very first line after a header, we might want to trim it if it's just whitespace
                // but generally we append to the last message's content.
                messages[messages.length - 1].content += '\n' + line;
            } else if (trimmed !== '') {
                // Fallback for non-matching leading lines (like legacy/irc logs)
                messages.push({ author: 'system', date: '', time: '', content: line });
            }
        }

        // Build HTML string
        // Apply offset to get original file line (codeNode.position is relative to processed content)
        const offset = (codeNode.data as any)?.sourceLineOffset || 0;
        const processedLine = codeNode.position?.start.line || 1;
        const sourceLine = processedLine + offset;
        const dataAttrs = `data-resolved="${isResolved}" data-important="${isImportant}" data-source-line="${sourceLine}" data-collapsed="${isResolved}"`;

        let html = `<div class="glint-widget glint-comment" ${dataAttrs}>`;

        // Header
        const firstMsg = messages[0];
        const snippet = summaryText || (firstMsg ? (firstMsg.content.length > 80 ? firstMsg.content.slice(0, 80).split('\n')[0] + '...' : firstMsg.content.split('\n')[0]) : '');

        html += `<div class="glint-comment-header ${isImportant ? 'important' : ''}">`;
        html += `<span class="comment-collapse-toggle">▼</span>`;
        if (isResolved) {
            html += `<span class="comment-status-icon">✓</span>`;
        } else if (isImportant) {
            html += `<span class="comment-status-icon">❗</span>`;
        }

        if (snippet) {
            html += `<span class="comment-header-snippet">${snippet}</span>`;
        } else {
            html += `<span>Comment Thread</span>`;
        }
        html += `</div>`;

        // Thread
        html += `<div class="glint-comment-thread">`;
        for (const msg of messages) {
            const timestamp = (msg.date || msg.time) ? (msg.time ? `${msg.date} ${msg.time}` : msg.date) : '';

            // Render markdown content
            let contentHtml = '';
            try {
                contentHtml = bodyProcessor.processSync(msg.content).toString();
            } catch (e) {
                contentHtml = msg.content; // Fallback to raw text
            }

            html += `<div class="glint-comment-item">`;
            html += `<div class="comment-meta"><span class="comment-author">${msg.author}</span>${timestamp ? `<span class="comment-date"> · ${timestamp}</span>` : ''}</div>`;
            html += `<div class="comment-body-wrapper"><div class="comment-content">${contentHtml}</div></div>`;
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

import type { Node, Parent } from 'unist';
import type { ListItem, Paragraph, Text } from 'mdast';
import { CONTINUE } from 'unist-util-visit';
import type { WidgetHandler, CustomTextNode, CustomParagraphNode, HASTElement, HASTText } from './types.js';

export const taskHandler: WidgetHandler = {
    match: (node: Node) => node.type === 'listItem',
    transform: (node: Node, index: number | undefined, parent: Parent | undefined) => {
        const listItem = node as ListItem;

        // Find first paragraph
        const paragraph = listItem.children.find(c => c.type === 'paragraph') as Paragraph | undefined;
        if (!paragraph) return CONTINUE;

        // Check for state marker
        let state: string | undefined;
        let markerMatch: RegExpMatchArray | null = null;

        // If GFM already handled it
        if (listItem.checked === true) {
            state = 'done';
        } else if (listItem.checked === false) {
            state = 'open';
        }

        // Check for custom markers or GFM markers in text (if not already handled)
        const firstChild = paragraph.children[0];
        if (firstChild && firstChild.type === 'text') {
            const textNode = firstChild as Text;
            // Match [ ], [x], [/], [w], [b], [c] at start
            markerMatch = textNode.value.match(/^\[([ x/wbc])\]\s*/i);
            if (markerMatch) {
                const marker = markerMatch[1].toLowerCase();
                if (marker === ' ') state = 'open';
                else if (marker === 'x') state = 'done';
                else if (marker === '/') state = 'progress';
                else if (marker === 'w') state = 'waiting';
                else if (marker === 'b') state = 'blocked';
                else if (marker === 'c') state = 'cancelled';

                // Strip marker from text
                textNode.value = textNode.value.slice(markerMatch[0].length);
            }
        }

        if (!state) return CONTINUE;

        // Extract metadata from the end of the last text node in the paragraph
        const lastChild = paragraph.children[paragraph.children.length - 1];
        const attrs: Record<string, string> = {};
        if (lastChild && lastChild.type === 'text') {
            const lastText = lastChild as Text;
            const metaMatch = lastText.value.match(/\s*\(([^)]+)\)$/);
            if (metaMatch) {
                const inner = metaMatch[1];
                const parts = inner.split(/\s+/);
                for (const part of parts) {
                    if (part.startsWith('@')) {
                        attrs.assignee = part.slice(1);
                    } else if (part.startsWith('#')) {
                        attrs.priority = part.slice(1);
                    } else if (part.includes(':')) {
                        const [key, value] = part.split(':');
                        attrs[key] = value;
                    }
                }
                // Strip metadata from text
                lastText.value = lastText.value.slice(0, lastText.value.length - metaMatch[0].length);
            }
        }

        // Prevent remark-rehype from adding its own GFM checkbox
        listItem.checked = undefined;

        // Transform to glint-task HAST via MDAST data
        const data = listItem.data || (listItem.data = {});
        data.hName = 'li';
        const hProperties = data.hProperties || (data.hProperties = {});

        hProperties.className = ['glint-task'];
        hProperties['data-state'] = state;

        for (const [key, value] of Object.entries(attrs)) {
            hProperties[`data-${key}`] = value;
        }

        // Icons based on state
        const icons: Record<string, string> = {
            open: '🟦',
            done: '✅',
            progress: '🏃',
            waiting: '⌛',
            blocked: '⛔',
            cancelled: '🚫'
        };

        // 1. Checkbox node
        const checkboxNode: CustomTextNode = {
            type: 'text',
            data: {
                hName: 'span',
                hProperties: { className: ['glint-task-check'], title: 'Change state' },
                hChildren: [{ type: 'text', value: icons[state] || '🟦' }]
            },
            value: '' // Text node needs value
        };

        // 2. Metadata Pills (if any)
        const hasMeta = (attrs.due || attrs.assignee || attrs.priority || attrs.created || attrs.completed || attrs.scheduled);
        const metaNode: CustomTextNode | null = hasMeta ? {
            type: 'text',
            data: {
                hName: 'span',
                hProperties: { className: ['glint-task-meta'] },
                hChildren: [
                    attrs.priority ? {
                        type: 'element' as const,
                        tagName: 'span',
                        properties: { className: ['meta-priority'], dataPriority: attrs.priority },
                        children: [{ type: 'text' as const, value: `#${attrs.priority}` }]
                    } : null,
                    attrs.assignee ? {
                        type: 'element' as const,
                        tagName: 'span',
                        properties: { className: ['meta-assignee'] },
                        children: [{ type: 'text' as const, value: `@${attrs.assignee}` }]
                    } : null,
                    attrs.due ? {
                        type: 'element' as const,
                        tagName: 'span',
                        properties: { className: ['meta-due'] },
                        children: [{ type: 'text' as const, value: `due:${attrs.due}` }]
                    } : null,
                    attrs.scheduled ? {
                        type: 'element' as const,
                        tagName: 'span',
                        properties: { className: ['meta-scheduled'] },
                        children: [{ type: 'text' as const, value: `plan:${attrs.scheduled}` }]
                    } : null
                    // created and completed are hidden from view
                ].filter((item): item is HASTElement => item !== null)
            },
            value: ''
        } : null;

        // 3. Content Row (Task Description + Meta)
        const contentRow: CustomParagraphNode = {
            type: 'paragraph',
            data: {
                hName: 'div',
                hProperties: { className: ['glint-task-content-row'] }
            },
            children: [
                {
                    type: 'paragraph',
                    data: { hName: 'span', hProperties: { className: ['glint-task-content'] } },
                    // Filter out GFM checkboxes added by remark-gfm
                    children: paragraph.children.filter(c => {
                        if ((c as any).type === 'checkbox') return false;
                        if (c.type === 'html' && (c as any).value.includes('<input')) return false;
                        return true;
                    })
                } as CustomParagraphNode,
                metaNode
            ].filter((item): item is Node => item !== null)
        };

        // 4. Header Container (Checkbox + Content Row) -> The styled "Task Box"
        const headerNode: CustomParagraphNode = {
            type: 'paragraph',
            data: {
                hName: 'div',
                hProperties: { className: ['glint-task-header'] }
            },
            children: [checkboxNode, contentRow]
        };

        // 5. Structure: li [ Header, ...Subtasks ]
        // Note: We use 'paragraph' type for wrappers to utilize remark-rehype's default block handling
        // but overridden with hName='div' so it renders as a DIV.

        // Render any remaining children (subtasks, secondary paragraphs)
        const subtasks = listItem.children.filter(c => c !== paragraph);

        // Replace listItem children
        listItem.children = [headerNode, ...subtasks];

        return CONTINUE;
    },
    getLLMInstructions: () => `
### Tasks
- Syntax: \`- [state] Task description (key:value ...)\`
- States: \`[ ]\` Open, \`[x]\` Done, \`[/]\` Progress, \`[w]\` Waiting, \`[b]\` Blocked, \`[c]\` Cancelled
- Metadata: \`#priority\`, \`@assignee\`, \`due:YYYY-MM-DD\`, \`remind:YYYY-MM-DD\`, \`created:YYYY-MM-DD\`, \`completed:YYYY-MM-DD\`
- Metadata optional: don't include if not specified or "default" (e.g. normal priority, no due date, etc.)
- Example: \`- [/] Refactor API (due:2024-03-01 @alice #urgent)\`
`
};

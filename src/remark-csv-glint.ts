import type { Plugin } from 'unified';
import type { Root, Code, Html } from 'mdast';
import { visit } from 'unist-util-visit';
import { escapeHtml } from './utils/html.js';

/**
 * Remark plugin to transform ```csv fenced blocks into HTML tables.
 * First row is the header (<th>), remaining rows are <td>. Reuses the
 * plain <table> markup so CSV tables inherit remark-gfm table styling.
 */
export const remarkCsvGlint: Plugin<[], Root> = function () {
    return (tree: Root) => {
        visit(tree, 'code', (node: Code, index, parent) => {
            if (node.lang !== 'csv' || !parent || index === undefined) return;

            const rows = parseCsv(node.value);
            if (rows.length === 0) return;

            const [header, ...body] = rows;
            const cell = (tag: string, s: string) => `<${tag}>${escapeHtml(s)}</${tag}>`;
            const row = (tag: string, cells: string[]) =>
                `<tr>${cells.map(c => cell(tag, c)).join('')}</tr>`;

            const html =
                `<table><thead>${row('th', header)}</thead>` +
                `<tbody>${body.map(r => row('td', r)).join('')}</tbody></table>`;

            const htmlNode: Html = { type: 'html', value: html };
            parent.children.splice(index, 1, htmlNode);
        });
    };
};

/**
 * Minimal RFC-4180-ish CSV parser: comma delimiter, \n or \r\n rows,
 * double-quoted fields (may contain commas/newlines), "" escapes a quote.
 * A trailing blank line does not produce an empty row.
 */
function parseCsv(input: string): string[][] {
    const rows: string[][] = [];
    let field = '';
    let row: string[] = [];
    let inQuotes = false;

    for (let i = 0; i < input.length; i++) {
        const c = input[i];
        if (inQuotes) {
            if (c === '"') {
                if (input[i + 1] === '"') { field += '"'; i++; }
                else inQuotes = false;
            } else {
                field += c;
            }
        } else if (c === '"') {
            inQuotes = true;
        } else if (c === ',') {
            row.push(field); field = '';
        } else if (c === '\n' || c === '\r') {
            if (c === '\r' && input[i + 1] === '\n') i++;
            row.push(field); field = '';
            rows.push(row); row = [];
        } else {
            field += c;
        }
    }
    // Flush the final field/row unless the input ended on a row separator.
    if (field !== '' || row.length > 0) {
        row.push(field);
        rows.push(row);
    }
    return rows;
}

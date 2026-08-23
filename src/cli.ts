#!/usr/bin/env node
import { Command } from 'commander';
import path from 'path';
import fs from 'node:fs/promises';
import { renderFile, renderMarkdown } from './render.js';

const program = new Command();

program
    .name('glint')
    .description('Render Markdown (with server-side math) to self-contained HTML. The wiki/editing surface is the static SPA (src/spa).')
    .version('0.1.0');

program
    .command('render')
    .description('Render a single Markdown file to a self-contained HTML file')
    .argument('[file]', 'Path to the .md file to render (omit with --stdin)')
    .option('-o, --output <file>', 'Output HTML file (defaults to <file>.html or stdout with --stdin)')
    .option('--theme <name>', 'Theme name override (e.g. nord, default)')
    .option('--stdin', 'Read markdown from stdin instead of a file')
    .option('--body-only', 'Emit a body fragment for embedding in an external template (e.g. VimR). Pair with --theme=nvim to inherit the host editor colorscheme')
    .action(async (file: string | undefined, options: { output?: string; theme?: string; stdin?: boolean; bodyOnly?: boolean }) => {
        let html: string;

        if (options.stdin) {
            const chunks: Buffer[] = [];
            for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
            const markdown = Buffer.concat(chunks).toString('utf8');
            html = await renderMarkdown({ markdown, theme: options.theme, bodyOnly: options.bodyOnly });
        } else {
            if (!file) { console.error('✗ Provide a file argument or use --stdin'); process.exit(1); }
            const filePath = path.resolve(file);
            const stats = await fs.stat(filePath).catch(() => null);
            if (!stats || !stats.isFile()) { console.error(`✗ Not a file: ${filePath}`); process.exit(1); }
            if (options.bodyOnly) {
                const markdown = await fs.readFile(filePath, 'utf8');
                html = await renderMarkdown({ markdown, theme: options.theme, fileDir: path.dirname(filePath), bodyOnly: true });
            } else {
                html = await renderFile({ filePath, theme: options.theme });
            }
        }

        if (options.stdin && !options.output) {
            process.stdout.write(html);
        } else {
            const outPath = options.output
                ? path.resolve(options.output)
                : path.resolve(file!).replace(/\.md$/i, '') + '.html';
            await fs.writeFile(outPath, html);
            if (!options.stdin) console.log(`✓ rendered ${path.basename(file!)} -> ${outPath}`);
        }
    });

const SKILL_TEXT = `---
name: glint-markdown
description: Reference for Glint-flavored Markdown extensions (math, diagrams, tasks, wiki links, citations)
---

# Glint Markdown Extensions

Glint renders standard Markdown plus the extensions below. Use this as a reference when writing content for the static SPA or the \`glint render\` command.

## Math (KaTeX)

Inline: \`$E = mc^2$\`
Block:
\`\`\`
$$
\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}
$$
\`\`\`

## Mermaid Diagrams

\`\`\`mermaid
graph LR
  A --> B --> C
\`\`\`

Rendered client-side. Any valid Mermaid diagram type is supported.

## ABC Music Notation (abcjs)

\`\`\`abcjs
X:1
T:Scale
M:4/4
L:1/8
K:C
CDEFGAB c|
\`\`\`

Renders as an interactive music score. Use language \`abcjs\` or \`abc\`. See https://abcjs.net for syntax.

## Wiki Links

\`[[Page Name]]\` → links to \`Page Name.md\`
\`[[Page Name|Label]]\` → links with custom label

Broken links (file not found) render with a \`broken-link\` CSS class.

## Citations

Inline: \`[[#ref:mykey]]\` — rendered as a numbered superscript.

Reference list (must be under a \`## References\` heading):
\`\`\`
## References

- [ref:mykey] "Title of Work" Author Name (2024) https://example.com
\`\`\`

## Task Widget

Tasks are list items with a bracketed state marker:

| Syntax | State |
|--------|-------|
| \`- [ ] description\` | open |
| \`- [x] description\` | done |
| \`- [/] description\` | in progress |
| \`- [w] description\` | waiting |
| \`- [b] description\` | blocked |
| \`- [c] description\` | cancelled |

Optional metadata appended to the description:

\`\`\`
- [ ] Fix the bug #high @alice due:2024-12-01 scheduled:2024-11-28 created:2024-11-01
\`\`\`

Metadata tokens: \`#priority\`, \`@assignee\`, \`due:YYYY-MM-DD\`, \`scheduled:YYYY-MM-DD\`, \`created:YYYY-MM-DD\`, \`completed:YYYY-MM-DD\`


## GitHub-Flavored Markdown

Standard GFM is fully supported: tables, strikethrough (\`~~text~~\`), task checkboxes in lists, fenced code blocks with syntax highlighting, and autolinked URLs.

`;

program
    .command('skill')
    .description('Print a skill/reference file describing Glint markdown extensions to stdout')
    .action(() => {
        process.stdout.write(SKILL_TEXT);
    });

program.parse();

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
    .option('--color-scheme <name>', 'Color scheme name override (e.g. nord, default)')
    .option('--stdin', 'Read markdown from stdin instead of a file')
    .option('--body-only', 'Emit a body fragment for embedding in an external template (e.g. VimR). Pair with --color-scheme=nvim to inherit the host editor colorscheme')
    .action(async (file: string | undefined, options: { output?: string; colorScheme?: string; stdin?: boolean; bodyOnly?: boolean }) => {
        let html: string;

        if (options.stdin) {
            const chunks: Buffer[] = [];
            for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
            const markdown = Buffer.concat(chunks).toString('utf8');
            html = await renderMarkdown({ markdown, colorScheme: options.colorScheme, bodyOnly: options.bodyOnly });
        } else {
            if (!file) { console.error('✗ Provide a file argument or use --stdin'); process.exit(1); }
            const filePath = path.resolve(file);
            const stats = await fs.stat(filePath).catch(() => null);
            if (!stats || !stats.isFile()) { console.error(`✗ Not a file: ${filePath}`); process.exit(1); }
            if (options.bodyOnly) {
                const markdown = await fs.readFile(filePath, 'utf8');
                html = await renderMarkdown({ markdown, colorScheme: options.colorScheme, fileDir: path.dirname(filePath), bodyOnly: true });
            } else {
                html = await renderFile({ filePath, colorScheme: options.colorScheme });
            }
        }

        // --body-only exists for embedding hosts (VimR) that read the fragment from
        // stdout; writing a sidecar .html file for it makes no sense (#95). Stream to
        // stdout for --stdin or --body-only unless an explicit --output is given.
        if ((options.stdin || options.bodyOnly) && !options.output) {
            process.stdout.write(html);
        } else {
            const outPath = options.output
                ? path.resolve(options.output)
                : path.resolve(file!).replace(/\.md$/i, '') + '.html';
            await fs.writeFile(outPath, html);
            if (!options.stdin) console.log(`✓ rendered ${path.basename(file!)} -> ${outPath}`);
        }
    });

program.parse();

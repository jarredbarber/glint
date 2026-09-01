#!/usr/bin/env node
import { Command } from 'commander';
import path from 'path';
import fs from 'node:fs/promises';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { renderFile, renderMarkdown } from './render.js';

// ponytail: hand-rolled static server so `glint-md app` needs no extra dep.
const MIME: Record<string, string> = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
    '.txt': 'text/plain', '.md': 'text/markdown', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
    '.wasm': 'application/wasm', '.gz': 'application/gzip', '.map': 'application/json',
};

const { version } = JSON.parse(
    await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

const program = new Command();

program
    .name('glint-md')
    .description('Render Markdown (with server-side math) to self-contained HTML. The wiki/editing surface is the static SPA (src/spa).')
    .version(version);

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

program
    .command('app')
    .description('Serve the Glint SPA from localhost so local folders never leave your machine')
    .option('-p, --port <port>', 'Port to listen on', '8080')
    .option('--no-open', 'Do not open a browser')
    .action(async (options: { port: string; open: boolean }) => {
        const root = path.resolve(new URL('../dist-spa', import.meta.url).pathname);
        if (!(await fs.stat(root).catch(() => null))) {
            console.error(`✗ SPA assets missing at ${root} (reinstall glint-md)`);
            process.exit(1);
        }
        const server = http.createServer(async (req, res) => {
            // Strip query/hash and decode, then resolve inside root to block path traversal.
            const rel = decodeURIComponent((req.url || '/').split('?')[0].split('#')[0]);
            let filePath = path.join(root, rel === '/' ? 'index.html' : rel);
            if (!filePath.startsWith(root)) { res.writeHead(403).end(); return; }
            let data = await fs.readFile(filePath).catch(() => null);
            if (!data) { // SPA uses hash routes, so any unknown path falls back to index.html
                data = await fs.readFile(path.join(root, 'index.html')).catch(() => null);
                filePath = 'index.html';
            }
            if (!data) { res.writeHead(404).end(); return; }
            res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
            res.end(data);
        });
        const port = Number(options.port);
        server.listen(port, '127.0.0.1', () => {
            const url = `http://localhost:${port}/#/local`;
            console.log(`✓ Glint running at ${url}  (Ctrl+C to stop)`);
            if (options.open) {
                const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
                spawn(opener, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
            }
        });
    });

program.parse();

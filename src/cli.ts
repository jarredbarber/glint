#!/usr/bin/env node
import { Command } from 'commander';
import path from 'path';
import fs from 'node:fs/promises';
import { createServer } from './server.js';
import { renderFile } from './render.js';

const program = new Command();

program
    .name('glint')
    .description('Self-contained Markdown server with math rendering')
    .version('0.1.0');

program
    .command('serve')
    .description('Start the Glint server')
    .argument('[path]', 'Path to content directory', process.cwd())
    .action(async (contentPath: string) => {
        const resolvedPath = path.resolve(contentPath);
        let contentDir = resolvedPath;
        const stats = await fs.stat(resolvedPath);
        let configPath: string | undefined;

        if (stats.isFile()) {
            contentDir = path.dirname(resolvedPath);
            configPath = resolvedPath;
            console.log(`Starting Glint server from config file: ${resolvedPath}`);
        } else {
            console.log(`Starting Glint server...`);
            console.log(`Content directory: ${contentDir}`);
        }

        const { fastify, config } = await createServer(contentDir, configPath);

        try {
            await fastify.listen({ port: config.port, host: config.host });
            console.log(`Server listening on http://${config.host}:${config.port}`);
        } catch (err) {
            fastify.log.error(err);
            process.exit(1);
        }
    });

program
    .command('render')
    .description('Render a single Markdown file to a self-contained HTML file')
    .argument('<file>', 'Path to the .md file to render')
    .option('-o, --output <file>', 'Output HTML file (defaults to <file>.html)')
    .option('--theme <name>', 'Theme name override (e.g. nord, default)')
    .action(async (file: string, options: { output?: string; theme?: string }) => {
        const filePath = path.resolve(file);
        const stats = await fs.stat(filePath).catch(() => null);
        if (!stats || !stats.isFile()) {
            console.error(`✗ Not a file: ${filePath}`);
            process.exit(1);
        }

        const outPath = options.output
            ? path.resolve(options.output)
            : filePath.replace(/\.md$/i, '') + '.html';

        const html = await renderFile({ filePath, theme: options.theme });
        await fs.writeFile(outPath, html);
        console.log(`✓ rendered ${path.basename(filePath)} -> ${outPath}`);
    });

program.parse();

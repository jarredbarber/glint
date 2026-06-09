#!/usr/bin/env node
import { Command } from 'commander';
import path from 'path';
import fs from 'node:fs/promises';
import { createServer } from './server.js';
import { loadConfig } from './config.js';
import { buildSite } from './build.js';

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
    .command('build')
    .description('Build a static HTML snapshot of the wiki')
    .argument('[path]', 'Path to content directory', process.cwd())
    .option('-o, --out <dir>', 'Output directory', 'dist')
    .action(async (contentPath: string, options: { out: string }) => {
        const resolvedPath = path.resolve(contentPath);
        const stats = await fs.stat(resolvedPath);
        let contentDir = resolvedPath;
        let configPath: string | undefined;
        if (stats.isFile()) {
            contentDir = path.dirname(resolvedPath);
            configPath = resolvedPath;
        }
        const outDir = path.resolve(options.out);

        console.log(`Building static site...`);
        console.log(`  content: ${contentDir}`);
        console.log(`  output:  ${outDir}`);

        const result = await buildSite({ contentDir, outDir, configPath });

        console.log(`✓ ${result.pages} pages, ${result.assetsCopied} asset files`);
        if (result.failures.length > 0) {
            console.error(`✗ ${result.failures.length} pages failed:`);
            for (const f of result.failures) console.error(`  ${f.path}: ${f.error}`);
            process.exit(1);
        }
    });

program.parse();

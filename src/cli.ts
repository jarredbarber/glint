#!/usr/bin/env node
import { Command } from 'commander';
import path from 'path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from './server.js';
import { loadConfig } from './config.js';
import { buildSite, watchSite } from './build.js';

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
    .option('-w, --watch', 'Rebuild on file changes')
    .option('--prefix <path>', 'Base path prefix for hosting under a subpath (e.g. /wiki)')
    .option('--post-hook <command>', 'Shell command to run after a successful build (e.g. a deploy)')
    .action(async (contentPath: string, options: { out: string; watch?: boolean; prefix?: string; postHook?: string }) => {
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

        if (options.prefix) console.log(`  prefix:  ${options.prefix}`);
        if (options.postHook) console.log(`  hook:    ${options.postHook}`);

        // Runs the post-hook command, inheriting stdio. Resolves when it exits
        // (never rejects — a failed hook is logged, not fatal, so the watcher
        // keeps running).
        const runPostHook = (cmd: string) => new Promise<void>((resolve) => {
            console.log(`Running post-hook: ${cmd}`);
            const child = spawn(cmd, { shell: true, stdio: 'inherit' });
            child.on('exit', (code) => {
                if (code !== 0) console.error(`✗ post-hook exited with code ${code}`);
                resolve();
            });
            child.on('error', (err) => {
                console.error(`✗ post-hook error: ${err.message}`);
                resolve();
            });
        });

        if (options.watch) {
            const onRebuild = options.postHook ? () => runPostHook(options.postHook!) : undefined;
            const stop = await watchSite({ contentDir, outDir, configPath, prefix: options.prefix }, console.log, onRebuild);
            const shutdown = () => { void stop().then(() => process.exit(0)); };
            process.on('SIGINT', shutdown);
            process.on('SIGTERM', shutdown);
            return; // keep process alive on the persistent watcher
        }

        const result = await buildSite({ contentDir, outDir, configPath, prefix: options.prefix });

        console.log(`✓ ${result.pages} pages, ${result.assetsCopied} asset files`);
        if (result.failures.length > 0) {
            console.error(`✗ ${result.failures.length} pages failed:`);
            for (const f of result.failures) console.error(`  ${f.path}: ${f.error}`);
            process.exit(1);
        }

        // One-shot mode: run the deploy hook after a clean build.
        if (options.postHook) await runPostHook(options.postHook);
    });

program.parse();

#!/usr/bin/env node
import { Command } from 'commander';
import path from 'path';
import { createServer } from './server.js';

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
        const contentDir = path.resolve(contentPath);

        console.log(`Starting Glint server...`);
        console.log(`Content directory: ${contentDir}`);

        const { fastify, config } = await createServer(contentDir);

        try {
            await fastify.listen({ port: config.port, host: config.host });
            console.log(`Server listening on http://${config.host}:${config.port}`);
        } catch (err) {
            fastify.log.error(err);
            process.exit(1);
        }
    });

program.parse();

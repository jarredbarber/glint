#!/usr/bin/env node
import { Command } from 'commander';
import path from 'path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { createServer } from './server.js';
import { hashPassword } from './server/auth.js';
import { loadConfig, getConfigPath } from './config.js';

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

program
    .command('setup-auth')
    .description('Configure authentication for the Glint server')
    .argument('[path]', 'Path to content directory', process.cwd())
    .action(async (contentPath: string) => {
        const contentDir = path.resolve(contentPath);
        const configPath = await getConfigPath(contentDir);

        console.log('Glint Authentication Setup');
        console.log('==========================\n');

        // Load existing config
        let config: Record<string, unknown>;
        try {
            const existing = await fs.readFile(configPath, 'utf-8');
            config = JSON.parse(existing);
        } catch {
            config = {};
        }

        // Prompt for password
        const password = await promptPassword('Enter admin password: ');
        if (!password || password.length < 8) {
            console.error('Error: Password must be at least 8 characters.');
            process.exit(1);
        }

        const confirm = await promptPassword('Confirm password: ');
        if (password !== confirm) {
            console.error('Error: Passwords do not match.');
            process.exit(1);
        }

        // Hash password and generate session secret
        const passwordHash = await hashPassword(password);
        const sessionSecret = crypto.randomBytes(32).toString('base64');

        // Update config
        config.auth = {
            enabled: true,
            passwordHash,
            sessionSecret,
            public: (config.auth as any)?.public || [],
        };

        // Write config
        const dotGlintDir = path.dirname(configPath);
        await fs.mkdir(dotGlintDir, { recursive: true });
        await fs.writeFile(configPath, JSON.stringify(config, null, 4));

        console.log('\nAuthentication configured successfully!');
        console.log('The glint.json file has been updated.');
        console.log('\nTo make paths publicly accessible, add them to auth.public:');
        console.log('  "public": [{ "path": "docs/*", "access": "view" }]');
    });

program.parse();

function promptPassword(prompt: string): Promise<string> {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        // Hide input for password
        const stdin = process.stdin;
        if (stdin.isTTY) {
            stdin.setRawMode(true);
        }

        process.stdout.write(prompt);

        let password = '';
        stdin.resume();
        stdin.on('data', (char) => {
            const str = char.toString();

            if (str === '\n' || str === '\r' || str === '\u0004') {
                if (stdin.isTTY) {
                    stdin.setRawMode(false);
                }
                stdin.pause();
                process.stdout.write('\n');
                rl.close();
                resolve(password);
            } else if (str === '\u0003') {
                // Ctrl+C
                process.exit();
            } else if (str === '\u007F' || str === '\b') {
                // Backspace
                if (password.length > 0) {
                    password = password.slice(0, -1);
                    process.stdout.write('\b \b');
                }
            } else {
                password += str;
                process.stdout.write('*');
            }
        });
    });
}

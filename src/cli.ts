#!/usr/bin/env node
import { Command } from 'commander';
import path from 'path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { createServer } from './server.js';
import { hashPassword, generateServiceToken } from './server/auth.js';
import { loadConfig, getConfigPath, saveConfig } from './config.js';

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
    .command('setup-auth')
    .description('Configure authentication for the Glint server')
    .argument('[path]', 'Path to content directory', process.cwd())
    .action(async (contentPath: string) => {
        const contentDir = path.resolve(contentPath);
        const config = await loadConfig(contentDir);

        console.log('Glint Authentication Setup');
        console.log('==========================\n');

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
        const newAuth = {
            enabled: true,
            passwordHash,
            sessionSecret,
            public: config.auth?.public || [],
        };

        // Save config
        await saveConfig(contentDir, { ...config, auth: newAuth });

        const actualConfigPath = await getConfigPath(contentDir);
        console.log(`\nAuthentication configured successfully!`);
        console.log(`The configuration file (${path.basename(actualConfigPath)}) has been updated.`);
        console.log(`\nTo make paths publicly accessible, add them to auth.public:`);
        console.log(`  [[auth.public]]`);
        console.log(`  path = "docs/*"`);
        console.log(`  access = "view"`);
    });

program
    .command('auth-token')
    .description('Manage service tokens for external agents (e.g. Hector AI)')
    .argument('action', 'Action to perform: generate')
    .argument('[path]', 'Path to content directory', process.cwd())
    .action(async (action: string, contentPath: string) => {
        if (action !== 'generate') {
            console.error('Error: Unknown action. Supported actions: generate');
            process.exit(1);
        }

        const contentDir = path.resolve(contentPath);
        const config = await loadConfig(contentDir);

        console.log('Glint Service Token Generation');
        console.log('=============================\n');

        const { token, hash } = await generateServiceToken();

        const auth = config.auth || { enabled: true, public: [] };
        auth.serviceTokenHash = hash;

        // Save config
        await saveConfig(contentDir, { ...config, auth });

        console.log('New service token generated and stored in config.\n');
        console.log('IMPORTANT: Copy this token now. It will not be shown again.');
        console.log('TOKEN: ' + token + '\n');
        console.log('Store this in Hector\'s GLINT_SERVICE_TOKEN environment variable.');
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

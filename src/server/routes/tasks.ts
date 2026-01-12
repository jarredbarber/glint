import type { FastifyInstance } from 'fastify';
import { TaskScanner } from '../../tasks/scanner.js';
import * as renderer from '../../renderer.js';
import { loadConfig } from '../../config.js';
import { buildFileTree } from '../../filetree.js';
import path from 'node:path';
import fs from 'node:fs/promises';

export async function setupTaskRoutes(fastify: FastifyInstance, contentDir: string, scanner: TaskScanner) {

    // API: Get all tasks
    fastify.get('/api/tasks', async (request, reply) => {
        const tasks = scanner.getAllTasks();
        return tasks;
    });

    // Page: Task View Dashboard
    fastify.get('/tasks', async (request, reply) => {
        const config = await loadConfig(contentDir);
        const fileTree = await buildFileTree(contentDir);

        // Initial scan if cache is empty
        let tasks = scanner.getAllTasks();
        if (tasks.length === 0) {
            tasks = await scanner.scanAll();
        }

        const html = renderer.renderHtml({
            title: 'Task Dashboard',
            content: '<div id="task-view-root">Loading tasks...</div>',
            fileTree,
            config,
            scripts: ['/assets/task-view.bundle.js'],
            styles: ['/assets/task-view.css'],
            currentPath: '/tasks',
            authEnabled: config.auth?.enabled ?? false,
            authenticated: request.isAuthenticated()
        });


        reply.type('text/html').send(html);
    });

    // API: Toggle task state
    fastify.post('/api/task/toggle', async (request, reply) => {
        const { sourcePath, lineNumber, newState } = request.body as {
            sourcePath: string,
            lineNumber: number,
            newState?: string
        };

        const fullPath = path.join(contentDir, sourcePath);

        try {
            const content = await fs.readFile(fullPath, 'utf-8');
            const lines = content.split('\n');
            const lineIndex = lineNumber - 1;
            const line = lines[lineIndex];

            // Match task line
            const taskMatch = line.match(/^(\s*)-\s*\[([ x/wbc])\]\s*(.*)$/i);
            if (!taskMatch) {
                return reply.status(400).send({ error: 'Not a task line' });
            }

            const [indent, oldMarker, rest] = taskMatch.slice(1);
            let marker = newState || (oldMarker === ' ' ? 'x' : ' ');

            // Map common states to markers
            const stateToMarker: Record<string, string> = {
                'open': ' ',
                'done': 'x',
                'progress': '/',
                'waiting': 'w',
                'blocked': 'b',
                'cancelled': 'c'
            };
            if (stateToMarker[marker]) marker = stateToMarker[marker];

            // Add completed date if marking as done
            let newRest = rest;
            if (marker === 'x' && !rest.includes('completed:')) {
                const today = new Date().toISOString().split('T')[0];
                if (newRest.match(/\s*\(([^)]+)\)$/)) {
                    newRest = newRest.replace(/\)$/, ` completed:${today})`);
                } else {
                    newRest = `${newRest} (completed:${today})`;
                }
            } else if (marker === ' ' && rest.includes('completed:')) {
                // Remove completed date if unmarking
                newRest = newRest.replace(/\s*completed:\d{4}-\d{2}-\d{2}/, '');
            }

            lines[lineIndex] = `${indent}- [${marker}] ${newRest}`;
            await fs.writeFile(fullPath, lines.join('\n'), 'utf-8');

            // Invalidate scanner cache
            scanner.invalidate(sourcePath);

            return { success: true, newState: marker };
        } catch (error) {
            fastify.log.error(error);
            return reply.status(500).send({ error: 'Failed to update task' });
        }
    });
}


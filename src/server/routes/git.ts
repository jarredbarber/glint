/**
 * Git Sync Routes - Automatic pull/push for Glint content
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { type GlintConfig, type AccessLevel } from '../../config.js';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

interface GitStatus {
    isRepo: boolean;
    branch: string | null;
    ahead: number;
    behind: number;
    hasChanges: boolean;
    clean: boolean;
    message?: string;
}

interface GitSyncResult {
    success: boolean;
    pulledChanges: boolean;
    pushedChanges: boolean;
    messages: string[];
    error?: string;
}

async function gitExec(contentDir: string, command: string): Promise<string> {
    try {
        const { stdout } = await execAsync(command, {
            cwd: contentDir,
            timeout: 30000,
        });
        return stdout.trim();
    } catch (error: any) {
        throw new Error(error.stderr || error.message);
    }
}

async function getGitStatus(contentDir: string): Promise<GitStatus> {
    try {
        await gitExec(contentDir, 'git rev-parse --git-dir');

        let branch: string | null = null;
        try {
            branch = await gitExec(contentDir, 'git rev-parse --abbrev-ref HEAD');
        } catch { branch = null; }

        let hasRemote = false;
        try {
            const remotes = await gitExec(contentDir, 'git remote');
            hasRemote = remotes.trim().length > 0;
        } catch { hasRemote = false; }

        if (hasRemote) {
            try { await gitExec(contentDir, 'git fetch --quiet'); } catch {}
        }

        let ahead = 0, behind = 0;
        if (branch && hasRemote) {
            try {
                const revList = await gitExec(contentDir, `git rev-list --left-right --count origin/${branch}...HEAD`);
                const parts = revList.split('\t');
                if (parts.length === 2) {
                    behind = parseInt(parts[0]) || 0;
                    ahead = parseInt(parts[1]) || 0;
                }
            } catch {}
        }

        const status = await gitExec(contentDir, 'git status --porcelain');
        const hasChanges = status.length > 0;

        return { isRepo: true, branch, ahead, behind, hasChanges, clean: !hasChanges && ahead === 0 };
    } catch (error: any) {
        return { isRepo: false, branch: null, ahead: 0, behind: 0, hasChanges: false, clean: true, message: error.message };
    }
}

async function performGitSync(contentDir: string): Promise<GitSyncResult> {
    const messages: string[] = [];
    let pulledChanges = false, pushedChanges = false;

    try {
        const status = await getGitStatus(contentDir);
        if (!status.isRepo) {
            return { success: false, pulledChanges: false, pushedChanges: false, messages: [], error: 'Not a git repository' };
        }
        if (!status.branch) {
            return { success: false, pulledChanges: false, pushedChanges: false, messages: [], error: 'No branch found' };
        }

        const remotes = await gitExec(contentDir, 'git remote');
        if (!remotes.trim()) {
            return { success: false, pulledChanges: false, pushedChanges: false, messages: [], error: 'No remote configured' };
        }

        if (status.hasChanges) {
            try {
                await gitExec(contentDir, 'git add -A');
                await gitExec(contentDir, `git commit -m "Auto-sync: ${new Date().toISOString()}"`);
                messages.push('Committed local changes');
            } catch {}
        }

        try {
            await gitExec(contentDir, 'git fetch');
            messages.push('Fetched from remote');
        } catch (error: any) {
            return { success: false, pulledChanges: false, pushedChanges: false, messages, error: 'Fetch failed: ' + error.message };
        }

        const updatedStatus = await getGitStatus(contentDir);
        if (updatedStatus.behind > 0) {
            try {
                await gitExec(contentDir, 'git pull --ff-only');
                messages.push('Pulled remote changes');
                pulledChanges = true;
            } catch (error: any) {
                if (error.message.includes('Not possible to fast-forward')) {
                    return { success: false, pulledChanges: false, pushedChanges: false, messages, error: 'Merge conflicts detected' };
                }
                return { success: false, pulledChanges: false, pushedChanges: false, messages, error: 'Pull failed: ' + error.message };
            }
        }

        const finalStatus = await getGitStatus(contentDir);
        if (finalStatus.ahead > 0) {
            try {
                await gitExec(contentDir, `git push origin ${status.branch}`);
                messages.push('Pushed local changes');
                pushedChanges = true;
            } catch (error: any) {
                return { success: false, pulledChanges, pushedChanges: false, messages, error: 'Push failed: ' + error.message };
            }
        }

        if (!pulledChanges && !pushedChanges) messages.push('Already up to date');
        return { success: true, pulledChanges, pushedChanges, messages };
    } catch (error: any) {
        return { success: false, pulledChanges, pushedChanges, messages, error: error.message };
    }
}

export async function setupGitRoutes(
    fastify: FastifyInstance,
    contentDir: string,
    getConfig: () => GlintConfig
) {
    const requireAccess = (request: FastifyRequest, reply: FastifyReply, level: AccessLevel): boolean => {
        const access = request.getAccess('/');
        if (access === null) {
            reply.code(401).send({ error: 'Authentication required', authRequired: true });
            return false;
        }
        const hierarchy: Record<AccessLevel, number> = { view: 1, comment: 2, edit: 3 };
        if (hierarchy[access] < hierarchy[level]) {
            reply.code(403).send({ error: 'Insufficient permissions' });
            return false;
        }
        return true;
    };

    fastify.get('/api/git/status', async (request, reply) => {
        if (!requireAccess(request, reply, 'view')) return;
        try {
            return await getGitStatus(contentDir);
        } catch (error: any) {
            return reply.code(500).send({ error: 'Failed to get git status' });
        }
    });

    fastify.post('/api/git/sync', async (request, reply) => {
        if (!requireAccess(request, reply, 'edit')) return;
        try {
            const result = await performGitSync(contentDir);
            if (!result.success) return reply.code(400).send(result);
            return result;
        } catch (error: any) {
            return reply.code(500).send({ error: 'Sync failed: ' + error.message });
        }
    });

    fastify.post('/api/git/pull', async (request, reply) => {
        if (!requireAccess(request, reply, 'edit')) return;
        try {
            const status = await getGitStatus(contentDir);
            if (!status.isRepo) return reply.code(400).send({ error: 'Not a git repository' });
            const result = await gitExec(contentDir, 'git pull --ff-only');
            return { success: true, changes: status.behind > 0, message: result || 'Already up to date' };
        } catch (error: any) {
            return reply.code(400).send({ error: 'Pull failed: ' + error.message });
        }
    });

    fastify.post('/api/git/push', async (request, reply) => {
        if (!requireAccess(request, reply, 'edit')) return;
        try {
            const status = await getGitStatus(contentDir);
            if (!status.isRepo) return reply.code(400).send({ error: 'Not a git repository' });
            if (!status.branch) return reply.code(400).send({ error: 'No branch to push' });
            const result = await gitExec(contentDir, `git push origin ${status.branch}`);
            return { success: true, pushed: status.ahead > 0, message: result || 'Already up to date' };
        } catch (error: any) {
            return reply.code(400).send({ error: 'Push failed: ' + error.message });
        }
    });
}

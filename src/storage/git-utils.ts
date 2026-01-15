/**
 * Shared git utilities for storage providers.
 * Extracted from LocalStorageProvider for reuse.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { GitStatus, GitSyncResult, GitPullResult, GitPushResult } from './types.js';

const execAsync = promisify(exec);

/**
 * Execute a git command in the specified directory.
 */
export async function gitExec(cwd: string, command: string): Promise<string> {
    try {
        const { stdout } = await execAsync(command, {
            cwd,
            timeout: 30000,
        });
        return stdout.trim();
    } catch (error: any) {
        throw new Error(error.stderr || error.message);
    }
}

/**
 * Check if a directory has a git remote configured.
 */
export async function hasRemote(cwd: string): Promise<boolean> {
    try {
        const remotes = await gitExec(cwd, 'git remote');
        return remotes.trim().length > 0;
    } catch {
        return false;
    }
}

/**
 * Get the git status for a directory.
 */
export async function getGitStatus(cwd: string): Promise<GitStatus> {
    try {
        await gitExec(cwd, 'git rev-parse --git-dir');

        let branch: string | null = null;
        try {
            branch = await gitExec(cwd, 'git rev-parse --abbrev-ref HEAD');
        } catch { branch = null; }

        const remoteExists = await hasRemote(cwd);

        if (remoteExists) {
            try { await gitExec(cwd, 'git fetch --quiet'); } catch { }
        }

        let ahead = 0, behind = 0;
        if (branch && remoteExists) {
            try {
                const revList = await gitExec(cwd, `git rev-list --left-right --count origin/${branch}...HEAD`);
                const parts = revList.split('\t');
                if (parts.length === 2) {
                    behind = parseInt(parts[0]) || 0;
                    ahead = parseInt(parts[1]) || 0;
                }
            } catch { }
        }

        const status = await gitExec(cwd, 'git status --porcelain');
        const hasChanges = status.length > 0;

        return { isRepo: true, branch, ahead, behind, hasChanges, clean: !hasChanges && ahead === 0 };
    } catch (error: any) {
        return { isRepo: false, branch: null, ahead: 0, behind: 0, hasChanges: false, clean: true, message: error.message };
    }
}

/**
 * Stage and commit all changes.
 */
export async function gitCommit(cwd: string, message: string): Promise<boolean> {
    try {
        await gitExec(cwd, 'git add -A');
        await gitExec(cwd, `git commit -m "${message.replace(/"/g, '\\"')}"`);
        return true;
    } catch {
        return false; // Nothing to commit or commit failed
    }
}

/**
 * Pull from remote (fast-forward only).
 */
export async function gitPull(cwd: string): Promise<GitPullResult> {
    try {
        const status = await getGitStatus(cwd);
        if (!status.isRepo) throw new Error('Not a git repository');

        const result = await gitExec(cwd, 'git pull --ff-only');
        return { success: true, changes: status.behind > 0, message: result || 'Already up to date' };
    } catch (error: any) {
        throw error;
    }
}

/**
 * Push to remote origin.
 */
export async function gitPush(cwd: string, branch?: string): Promise<GitPushResult> {
    try {
        const status = await getGitStatus(cwd);
        if (!status.isRepo) throw new Error('Not a git repository');

        const branchToPush = branch || status.branch;
        if (!branchToPush) throw new Error('No branch to push');

        const result = await gitExec(cwd, `git push origin ${branchToPush}`);
        return { success: true, pushed: status.ahead > 0, message: result || 'Already up to date' };
    } catch (error: any) {
        throw error;
    }
}

/**
 * Full sync: commit local changes, pull from remote, push to remote.
 */
export async function gitSync(cwd: string, commitMessage?: string): Promise<GitSyncResult> {
    const messages: string[] = [];
    let pulledChanges = false, pushedChanges = false;

    try {
        const status = await getGitStatus(cwd);
        if (!status.isRepo) {
            return { success: false, pulledChanges: false, pushedChanges: false, messages: [], error: 'Not a git repository' };
        }
        if (!status.branch) {
            return { success: false, pulledChanges: false, pushedChanges: false, messages: [], error: 'No branch found' };
        }

        const remoteExists = await hasRemote(cwd);
        if (!remoteExists) {
            // Local-only repo: just commit if there are changes
            if (status.hasChanges) {
                const msg = commitMessage || `Auto-sync: ${new Date().toISOString()}`;
                if (await gitCommit(cwd, msg)) {
                    messages.push('Committed local changes');
                }
            } else {
                messages.push('No changes to commit');
            }
            return { success: true, pulledChanges: false, pushedChanges: false, messages };
        }

        // Has remote: full sync
        if (status.hasChanges) {
            const msg = commitMessage || `Auto-sync: ${new Date().toISOString()}`;
            if (await gitCommit(cwd, msg)) {
                messages.push('Committed local changes');
            }
        }

        try {
            await gitExec(cwd, 'git fetch');
            messages.push('Fetched from remote');
        } catch (error: any) {
            return { success: false, pulledChanges: false, pushedChanges: false, messages, error: 'Fetch failed: ' + error.message };
        }

        const updatedStatus = await getGitStatus(cwd);
        if (updatedStatus.behind > 0) {
            try {
                await gitExec(cwd, 'git pull --ff-only');
                messages.push('Pulled remote changes');
                pulledChanges = true;
            } catch (error: any) {
                if (error.message.includes('Not possible to fast-forward')) {
                    return { success: false, pulledChanges: false, pushedChanges: false, messages, error: 'Merge conflicts detected' };
                }
                return { success: false, pulledChanges: false, pushedChanges: false, messages, error: 'Pull failed: ' + error.message };
            }
        }

        const finalStatus = await getGitStatus(cwd);
        if (finalStatus.ahead > 0) {
            try {
                await gitExec(cwd, `git push origin ${status.branch}`);
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

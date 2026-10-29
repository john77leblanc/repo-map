/**
 * A throwaway checkout of a review's head commit, so the AI tool reads the
 * changed code without switching the user's branch. The server creates and
 * removes it; the AI tool only reads inside it.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git } from './repo.mjs';
import { SHA } from './review-source.mjs';

const BASE_DIR = path.join(os.tmpdir(), 'repo-map-review');

/** Where this repo's review checkouts go (one folder per repo, outside it). */
function worktreeDir(root) {
    return path.join(BASE_DIR, createHash('sha1').update(path.resolve(root)).digest('hex').slice(0, 10));
}

/** Remove checkouts left behind by a crashed run, then let git forget them. */
async function pruneWorktrees(root) {
    const dir = worktreeDir(root);
    const entries = await fs.readdir(dir).catch(() => []);
    for (const name of entries) {
        await git(root, 'worktree', 'remove', '--force', path.join(dir, name));
        await fs.rm(path.join(dir, name), { recursive: true, force: true }).catch(() => {});
    }
    await git(root, 'worktree', 'prune');
}

/**
 * The folder where the AI should read `sha`: the checkout itself when it is at
 * that commit with no uncommitted changes, otherwise a temporary worktree.
 * Calls `fn(dir)` and always removes the worktree afterwards.
 */
async function withCheckout(root, sha, fn, { useCheckout = false } = {}) {
    if (useCheckout) return fn(root);
    if (!SHA.test(String(sha || ''))) throw Object.assign(new Error('Not a commit id.'), { code: 'ref' });
    const [head, dirty] = await Promise.all([
        git(root, 'rev-parse', 'HEAD'),
        git(root, 'status', '--porcelain', '--untracked-files=no'),
    ]);
    if (head === sha && !dirty) return fn(root);
    const parent = worktreeDir(root);
    await fs.mkdir(parent, { recursive: true });
    const dir = path.join(parent, `${sha.slice(0, 12)}-${randomUUID().slice(0, 8)}`);
    await git(root, 'worktree', 'add', '--detach', '--quiet', dir, sha);
    if (!existsSync(path.join(dir, '.git'))) {
        throw Object.assign(new Error(`Couldn't check out ${sha.slice(0, 9)} to read it.`), { code: 'worktree' });
    }
    try {
        return await fn(dir);
    } finally {
        await git(root, 'worktree', 'remove', '--force', dir);
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
        await git(root, 'worktree', 'prune');
    }
}

export { pruneWorktrees, withCheckout, worktreeDir };

/**
 * Git facts about the checkout and safe, read-only access to its files.
 */
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_FILE_BYTES = 2 * 1024 * 1024;

async function git(root, ...args) {
    try {
        const { stdout } = await execFileAsync('git', ['-C', root, ...args], { maxBuffer: 4 * 1024 * 1024 });
        return stdout.trim();
    } catch {
        return '';
    }
}

function githubFromRemote(remote) {
    const m = String(remote).match(/github\.com[:/]+([^/]+\/[^/]+?)(?:\.git)?$/);
    return m ? m[1] : '';
}

async function repoInfo(root, config) {
    const [sha, branch, remote, onRemote, status] = await Promise.all([
        git(root, 'rev-parse', 'HEAD'),
        git(root, 'branch', '--show-current'),
        git(root, 'remote', 'get-url', 'origin'),
        git(root, 'branch', '-r', '--contains', 'HEAD'),
        git(root, 'status', '--porcelain', '--untracked-files=no'),
    ]);
    // github: false turns links off (e.g. for a demo folder inside another repo)
    const slug = config.github === false ? '' : (config.github || githubFromRemote(remote));
    // GitHub links only resolve for commits on the remote. When HEAD isn't
    // pushed, point at its merge-base with the default branch (lines may differ).
    let ghRef = sha;
    const exact = Boolean(onRemote);
    if (!exact) {
        ghRef = (await git(root, 'merge-base', 'HEAD', `origin/${config.defaultBranch}`)) || config.defaultBranch;
    }
    return {
        sha,
        branch,
        github: slug,
        ghBase: slug ? `https://github.com/${slug}` : '',
        ghRef,
        exact,
        dirty: Boolean(status),
    };
}

/** Resolve a repo-relative path inside one of config.codeRoots, or null. */
function safePath(root, config, rel) {
    const clean = path.posix.normalize(String(rel || '').replace(/\\/g, '/')).replace(/^\/+/, '');
    if (!config.codeRoots.some((r) => r === '/' || clean.startsWith(r))) {
        return null;
    }
    const blocked = new Set(config.blocked);
    const segments = clean.split('/');
    if (segments.some((s) => s === '..' || blocked.has(s)) || /(^|\/)\.env/.test(clean) || clean.startsWith('.repo-map/')) {
        return null;
    }
    const abs = path.resolve(root, clean);
    return abs.startsWith(root + path.sep) ? { abs, clean } : null;
}

async function readLines(root, config, rel) {
    const target = safePath(root, config, rel);
    if (!target) {
        throw Object.assign(new Error(`Path is outside ${config.codeRoots.join(', ')}`), { status: 400 });
    }
    const stat = await fs.stat(target.abs).catch(() => null);
    if (!stat || !stat.isFile()) {
        throw Object.assign(new Error('File not found'), { status: 404 });
    }
    if (stat.size > MAX_FILE_BYTES) {
        throw Object.assign(new Error('File too large'), { status: 413 });
    }
    return { clean: target.clean, lines: (await fs.readFile(target.abs, 'utf8')).split('\n') };
}

export { git, githubFromRemote, readLines, repoInfo, safePath };

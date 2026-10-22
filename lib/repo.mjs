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

// Files repos keep for coding agents. Always readable as docs, and given to every agent run (guidance.mjs).
const GUIDANCE_FILES = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.github/copilot-instructions.md', '.cursorrules'];
const GUIDANCE_RULES_DIR = '.cursor/rules';

/** A filename glob ("**" crosses folders, "*" and "?" don't) as a RegExp that matches at a path boundary. */
function globToRegExp(glob) {
    const re = String(glob).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*');
    return new RegExp(`(^|/)${re}$`, 'i');
}

const matcherCache = new WeakMap();
/** Is `clean` (repo-relative, forward slashes) a document per config.docs, or an agent guidance file? */
function isDocPath(config, clean) {
    if (GUIDANCE_FILES.includes(clean) || (clean.startsWith(`${GUIDANCE_RULES_DIR}/`) && clean.endsWith('.mdc'))) {
        return true;
    }
    const docs = config.docs || {};
    let m = matcherCache.get(docs);
    if (!m) {
        m = { inc: (docs.include || []).map(globToRegExp), exc: (docs.exclude || []).map(globToRegExp) };
        matcherCache.set(docs, m);
    }
    return m.inc.some((r) => r.test(clean)) && !m.exc.some((r) => r.test(clean));
}

const inCodeRoots = (config, clean) => config.codeRoots.some((r) => r === '/' || clean.startsWith(r));

function resolveRel(root, config, rel, allowed) {
    const clean = path.posix.normalize(String(rel || '').replace(/\\/g, '/')).replace(/^\/+/, '');
    if (!allowed(clean)) {
        return null;
    }
    const blocked = new Set(config.blocked);
    const segments = clean.split('/');
    if (segments.some((s) => s === '..' || blocked.has(s)) || /(^|\/)\.env/.test(clean) || clean.startsWith('.repo-map/')) {
        return null;
    }
    const base = path.resolve(root);
    const abs = path.resolve(base, clean);
    return abs.startsWith(base + path.sep) ? { abs, clean } : null;
}

/** Resolve a repo-relative path inside one of config.codeRoots, or null. */
function safePath(root, config, rel) {
    return resolveRel(root, config, rel, (clean) => inCodeRoots(config, clean));
}

/** Like safePath, but documents (config.docs, agent guidance files) are readable wherever they are. */
function readablePath(root, config, rel) {
    return resolveRel(root, config, rel, (clean) => inCodeRoots(config, clean) || isDocPath(config, clean));
}

async function readLines(root, config, rel) {
    const target = readablePath(root, config, rel);
    if (!target) {
        throw Object.assign(new Error(`Path is outside ${config.codeRoots.join(', ')} and isn’t a document`), { status: 400 });
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

/** A { path, start, end } reference checked against the real file: null when unreadable, lines clamped. */
async function clampRef(root, config, ref) {
    try {
        const { clean, lines } = await readLines(root, config, ref && ref.path);
        const start = Math.max(1, Math.min(lines.length, parseInt(ref.start, 10) || 1));
        const end = Math.max(start, Math.min(lines.length, parseInt(ref.end, 10) || start));
        return { path: clean, start, end };
    } catch {
        return null;
    }
}

const SKIP_DIRS = new Set(['node_modules', '.git']);

/** Every document in the repo (config.docs plus agent guidance files), repo-relative, sorted, at most config.docs.maxFiles. */
async function findDocFiles(root, config) {
    const limit = (config.docs && config.docs.maxFiles) || 200;
    const blocked = new Set(config.blocked);
    const out = [];
    const walkDir = async (rel) => {
        let entries;
        try {
            entries = await fs.readdir(path.join(root, rel), { withFileTypes: true });
        } catch {
            return;
        }
        entries.sort((a, b) => a.name.localeCompare(b.name));
        for (const e of entries) {
            if (out.length >= limit) {
                return;
            }
            const child = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory()) {
                // dot-folders are skipped, except the ones agent guidance lives in
                const dotOk = child === '.github' || child === '.cursor' || child === GUIDANCE_RULES_DIR;
                if (!SKIP_DIRS.has(e.name) && !blocked.has(e.name) && child !== '.repo-map' && (!e.name.startsWith('.') || dotOk)) {
                    await walkDir(child);
                }
            } else if (e.isFile() && readablePath(root, config, child) && isDocPath(config, child)) {
                out.push(child);
            }
        }
    };
    await walkDir('');
    return out;
}

export { GUIDANCE_FILES, GUIDANCE_RULES_DIR, clampRef, findDocFiles, git, githubFromRemote, globToRegExp, isDocPath, readLines, readablePath, repoInfo, safePath };

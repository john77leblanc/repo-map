/**
 * What a review compares: two git refs, a GitHub pull request (through the gh
 * CLI), or the current branch with its uncommitted changes. Also tells whether
 * a saved review still matches the code (stale detection).
 */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { git } from './repo.mjs';

// Branch, tag and commit names, with ~ and ^ suffixes. Never an option, never a range.
const SAFE_REF = /^(?!-)(?!.*\.\.)[\w./@^~-]{1,200}$/;
const SHA = /^[0-9a-f]{7,40}$/i;
const PR_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/(\d{1,7})(?:[/?#].*)?$/;
const MAX_COMMITS = 30;

const fail = (message, code = 'review') => Object.assign(new Error(message), { code, status: 400 });

function checkRef(ref, what) {
    const value = String(ref || '').trim();
    if (!SAFE_REF.test(value)) throw fail(`${what} "${value.slice(0, 60)}" isn't a branch, tag or commit name.`, 'ref');
    return value;
}

/** A pull request number from "12", "#12" or its GitHub URL; '' when it is none of those. */
function prNumber(value) {
    const text = String(value || '').trim().replace(/^#/, '');
    if (/^\d{1,7}$/.test(text)) return text;
    return text.match(PR_URL)?.[1] || '';
}

/**
 * Run the gh CLI (read-only commands only). Rejects with code missing|auth|pr|failed.
 * `bin` may be an argv prefix ([node, fake-gh.mjs]) for tests.
 */
function gh(root, args, { timeoutMs = 30000, bin } = {}) {
    const [cmd, ...pre] = [].concat(bin || process.env.REPO_MAP_GH || 'gh');
    return new Promise((resolve, reject) => {
        execFile(cmd, [...pre, ...args], { cwd: root, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
            if (!err) return resolve(stdout);
            const text = `${stderr || ''}${err.message || ''}`;
            if (err.code === 'ENOENT') return reject(fail('The GitHub CLI (gh) isn\'t installed. Install it from https://cli.github.com, or review the branches by name instead.', 'missing'));
            if (/auth login|not logged|authenticat/i.test(text)) return reject(fail('The GitHub CLI isn\'t signed in. Run `gh auth login`, then try again.', 'auth'));
            if (/could not resolve|no pull requests? found|not found/i.test(text)) return reject(fail('GitHub has no such pull request for this repo.', 'pr'));
            reject(fail(`gh failed: ${String(stderr || err.message).trim().split('\n').pop()}`, 'failed'));
        });
    });
}

async function commitOf(root, ref) {
    return git(root, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`);
}

async function defaultBase(root, config) {
    const branch = config.defaultBranch || 'main';
    for (const ref of [`origin/${branch}`, branch]) {
        if (await commitOf(root, ref)) return ref;
    }
    throw fail(`Couldn't find the default branch (${branch}). Pick the base branch to compare against.`, 'ref');
}

/** Commit subjects between two commits, newest first: the author's own account of the change. */
async function commitsBetween(root, from, to) {
    const log = await git(root, 'log', `--max-count=${MAX_COMMITS}`, '--format=%h %s', `${from}..${to}`);
    return log.split('\n').filter(Boolean);
}

/** A fingerprint of uncommitted changes, so a local review knows when they move on. */
async function workingFingerprint(root) {
    const [status, diff] = await Promise.all([
        git(root, 'status', '--porcelain', '--untracked-files=no'),
        git(root, 'diff', 'HEAD'),
    ]);
    return status ? createHash('sha1').update(status).update('\0').update(diff).digest('hex').slice(0, 16) : '';
}

/**
 * Resolve what to review. One of:
 *   { pr: "12" | url }        a GitHub pull request (needs gh); its head is fetched when missing
 *   { local: true, base? }    the checkout, uncommitted changes included, against base
 *   { base?, head? }          two refs (base defaults to origin/<defaultBranch>, head to HEAD)
 * Returns { kind, base, head, baseSha, headSha, mergeBase, title, body, commits, number?, url?, dirty?, fingerprint? }.
 */
async function resolveReview(root, config, request = {}, { ghBin } = {}) {
    if (!(await git(root, 'rev-parse', '--git-dir'))) throw fail('This folder isn\'t a git repository, so there are no changes to review.', 'nogit');
    if (request.pr) {
        const number = prNumber(request.pr);
        if (!number) throw fail('Give a pull request number (e.g. 12) or its GitHub URL.', 'pr');
        const info = JSON.parse(await gh(root, ['pr', 'view', number, '--json', 'number,title,body,url,baseRefName,headRefName,headRefOid,baseRefOid'], { bin: ghBin }));
        if (!(await commitOf(root, info.headRefOid))) await git(root, 'fetch', '--quiet', 'origin', `pull/${number}/head`);
        if (!(await commitOf(root, info.headRefOid))) throw fail(`Couldn't fetch the code of pull request #${number}. Check that origin is its GitHub repo.`, 'fetch');
        if (!(await commitOf(root, info.baseRefOid))) await git(root, 'fetch', '--quiet', 'origin', checkRef(info.baseRefName, 'Base branch'));
        const baseSha = (await commitOf(root, info.baseRefOid)) || (await commitOf(root, `origin/${info.baseRefName}`));
        if (!baseSha) throw fail(`Couldn't find the base branch ${info.baseRefName}.`, 'fetch');
        const headSha = info.headRefOid;
        const mergeBase = (await git(root, 'merge-base', baseSha, headSha)) || baseSha;
        return { kind: 'pr', number: Number(info.number), url: String(info.url || ''), title: String(info.title || '').slice(0, 200),
            body: String(info.body || '').slice(0, 6000), base: info.baseRefName, head: info.headRefName,
            baseSha, headSha, mergeBase, commits: await commitsBetween(root, mergeBase, headSha) };
    }
    const base = request.base ? checkRef(request.base, 'Base') : await defaultBase(root, config);
    const baseSha = await commitOf(root, base);
    if (!baseSha) throw fail(`There is no branch, tag or commit called ${base}.`, 'ref');
    if (request.local) {
        const headSha = await commitOf(root, 'HEAD');
        if (!headSha) throw fail('This repository has no commits yet.', 'ref');
        const branch = await git(root, 'branch', '--show-current');
        const mergeBase = (await git(root, 'merge-base', baseSha, headSha)) || baseSha;
        const fingerprint = await workingFingerprint(root);
        return { kind: 'local', base, head: branch || 'HEAD', baseSha, headSha, mergeBase, dirty: !!fingerprint, fingerprint,
            title: `${branch || 'Local changes'} (local)`, body: '', commits: await commitsBetween(root, mergeBase, headSha) };
    }
    const head = request.head ? checkRef(request.head, 'Head') : 'HEAD';
    const headSha = await commitOf(root, head);
    if (!headSha) throw fail(`There is no branch, tag or commit called ${head}.`, 'ref');
    const named = head === 'HEAD' ? (await git(root, 'branch', '--show-current')) || 'HEAD' : head;
    const mergeBase = (await git(root, 'merge-base', baseSha, headSha)) || baseSha;
    return { kind: 'refs', base, head: named, headRef: head, baseSha, headSha, mergeBase,
        title: `${named} → ${base}`, body: '', commits: await commitsBetween(root, mergeBase, headSha) };
}

/**
 * Does a saved review still describe the code? `current`, `stale` (the head or
 * merge base moved; `reason` says how) or `unknown` (gh or the refs aren't available).
 */
async function reviewStatus(root, config, review, { ghBin } = {}) {
    if (!review || typeof review !== 'object') return { state: 'unknown', reason: 'Not a review.' };
    const stale = (reason) => ({ state: 'stale', reason });
    try {
        if (review.kind === 'pr') {
            const info = JSON.parse(await gh(root, ['pr', 'view', String(review.number), '--json', 'headRefOid,state'], { bin: ghBin }));
            if (info.headRefOid !== review.headSha) return stale('The pull request has new commits.');
            return { state: 'current', prState: String(info.state || '').toLowerCase() };
        }
        if (review.kind === 'local') {
            const head = await commitOf(root, 'HEAD');
            if (head !== review.headSha) return stale('The branch has new commits.');
            if ((await workingFingerprint(root)) !== (review.fingerprint || '')) return stale('Uncommitted changes changed.');
            return { state: 'current' };
        }
        if (review.kind === 'refs') {
            const ref = review.headRef || review.head;
            if (SHA.test(ref)) return { state: 'current' };
            const head = SAFE_REF.test(ref) ? await commitOf(root, ref) : '';
            if (!head) return { state: 'unknown', reason: `${ref} is gone.` };
            if (head !== review.headSha) return stale(`${review.head} has new commits.`);
            const base = SAFE_REF.test(review.base) ? await commitOf(root, review.base) : '';
            if (base && (await git(root, 'merge-base', base, head)) !== review.mergeBase) return stale(`${review.base} moved; the changes may differ now.`);
            return { state: 'current' };
        }
    } catch (err) {
        return { state: 'unknown', reason: err.message };
    }
    return { state: 'unknown', reason: 'Unknown review kind.' };
}

export { SHA, SAFE_REF, checkRef, gh, prNumber, resolveReview, reviewStatus, workingFingerprint };

/**
 * What the Review changes window offers to pick: branches (local and remote),
 * tags and open pull requests, plus a fetch to refresh remote branches.
 * Read-only, except `fetchRemote`, which updates remote-tracking refs on request.
 */
import { execFile } from 'node:child_process';
import { git } from './repo.mjs';
import { checkRef, gh } from './review-source.mjs';

const MAX_REFS = 500;
// Without %(ahead-behind:) (git < 2.41), counts are made one ref at a time: only for the most recent ones.
const MAX_SLOW_COUNTS = 60;
const FETCH_TIMEOUT_MS = 60000;
const FIELDS = ['%(refname)', '%(objectname)', '%(committerdate:unix)', '%(subject)'];

async function commitOf(root, ref) {
    return git(root, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`);
}

/** The ref name a review would show: `main`, `origin/feature`, `v1.2.0`. */
function shortName(refname) {
    return refname.replace(/^refs\/(heads|remotes|tags)\//, '');
}

function kindOf(refname) {
    return refname.startsWith('refs/heads/') ? 'local' : refname.startsWith('refs/remotes/') ? 'remote' : 'tag';
}

/** "ahead behind" for every ref in one call (git >= 2.41), or null when git can't. */
async function aheadBehindFast(root, baseSha) {
    const out = await git(root, 'for-each-ref', `--format=%(refname)%00%(ahead-behind:${baseSha})`, 'refs/heads', 'refs/remotes');
    if (!out || !out.includes('\0')) return null;
    const counts = new Map();
    for (const line of out.split('\n')) {
        const [name, value] = line.split('\0');
        const [ahead, behind] = String(value || '').split(' ').map(Number);
        if (Number.isInteger(ahead) && Number.isInteger(behind)) counts.set(name, { ahead, behind });
    }
    return counts.size ? counts : null;
}

async function aheadBehindSlow(root, baseSha, refs) {
    const counts = new Map();
    for (const ref of refs.filter((r) => r.kind !== 'tag').slice(0, MAX_SLOW_COUNTS)) {
        const out = await git(root, 'rev-list', '--left-right', '--count', `${baseSha}...${ref.sha}`);
        const [behind, ahead] = out.split(/\s+/).map(Number);
        if (Number.isInteger(ahead) && Number.isInteger(behind)) counts.set(ref.refname, { ahead, behind });
    }
    return counts;
}

/**
 * Branches and tags, most recently committed first, with how far each branch is
 * ahead of (and behind) `base` (default: origin/<defaultBranch>, else <defaultBranch>).
 * A remote branch at the same commit as the local branch of the same name is left
 * out; the local one says `alsoRemote`.
 */
async function listRefs(root, config, { base = '' } = {}) {
    const defaultBranch = config.defaultBranch || 'main';
    let aheadOf = base ? checkRef(base, 'Base') : '';
    if (!aheadOf) {
        for (const ref of [`origin/${defaultBranch}`, defaultBranch]) {
            if (await commitOf(root, ref)) { aheadOf = ref; break; }
        }
    }
    const [out, current] = await Promise.all([
        git(root, 'for-each-ref', '--sort=-committerdate', `--count=${MAX_REFS + 1}`, `--format=${FIELDS.join('%00')}`, 'refs/heads', 'refs/remotes', 'refs/tags'),
        git(root, 'branch', '--show-current'),
    ]);
    const all = out.split('\n').filter(Boolean).map((line) => {
        const [refname, sha, date, ...subject] = line.split('\0');
        return { refname, name: shortName(refname), kind: kindOf(refname), sha, date: Number(date) || 0, subject: subject.join(' ').slice(0, 200) };
    }).filter((r) => r.sha && !/\/HEAD$/.test(r.refname));
    const more = all.length > MAX_REFS;
    const local = new Map(all.filter((r) => r.kind === 'local').map((r) => [r.name, r]));
    const refs = all.slice(0, MAX_REFS).filter((r) => {
        if (r.kind !== 'remote') return true;
        const twin = local.get(r.name.replace(/^[^/]+\//, ''));
        if (twin && twin.sha === r.sha) {
            twin.alsoRemote = true;
            return false;
        }
        return true;
    });
    const baseSha = aheadOf ? await commitOf(root, aheadOf) : '';
    if (base && !baseSha) throw Object.assign(new Error(`There is no branch, tag or commit called ${base}.`), { code: 'ref', status: 400 });
    if (baseSha) {
        const counts = (await aheadBehindFast(root, baseSha)) || (await aheadBehindSlow(root, baseSha, refs));
        for (const r of refs) {
            const c = counts.get(r.refname);
            if (c) Object.assign(r, c);
        }
    }
    return {
        current, defaultBranch, aheadOf: baseSha ? aheadOf : '', more,
        refs: refs.map(({ refname, ...r }) => r),
    };
}

/** Open pull requests from the GitHub CLI; when gh can't be used, an empty list and why. */
async function listPrs(root, { ghBin } = {}) {
    try {
        const out = await gh(root, ['pr', 'list', '--state', 'open', '--limit', '50',
            '--json', 'number,title,author,headRefName,baseRefName,updatedAt,isDraft'], { bin: ghBin });
        const list = JSON.parse(out || '[]');
        const prs = (Array.isArray(list) ? list : []).map((p) => ({
            number: Number(p.number) || 0, title: String(p.title || '').slice(0, 200),
            author: String(p.author?.login || '').slice(0, 80), head: String(p.headRefName || '').slice(0, 200),
            base: String(p.baseRefName || '').slice(0, 200), updatedAt: String(p.updatedAt || ''), draft: p.isDraft === true,
        })).filter((p) => p.number > 0);
        return { prs };
    } catch (err) {
        return { prs: [], reason: err.message };
    }
}

/** Refresh remote branches from origin (asked for by the Fetch button). */
function fetchRemote(root) {
    return new Promise((resolve) => {
        execFile('git', ['-C', root, 'fetch', '--prune', '--quiet', 'origin'],
            { timeout: FETCH_TIMEOUT_MS, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, _out, stderr) => {
                if (!err) return resolve({ fetchedAt: new Date().toISOString() });
                const why = String(stderr || err.message || '').trim().split('\n').pop();
                resolve({ error: `Couldn't fetch from origin: ${why}` });
            });
    });
}

export { fetchRemote, listPrs, listRefs };

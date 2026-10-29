/**
 * Is the map out of date? Compares the commit recorded in map.json (the one the
 * map was last evaluated at) with HEAD, counting only changes under codeRoots.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { MAP_DIR } from './config.mjs';
import { git } from './repo.mjs';

const MAX_PATCH_BYTES = 150 * 1024;
const MAX_FILE_PATCH_BYTES = 8 * 1024;
const TOO_MANY_FILES = 400;

function pathspecs(config) {
    const roots = config.codeRoots.filter((r) => r !== './' && r !== '/');
    return roots.length ? ['--', ...roots] : [];
}

async function headCommit(root) {
    return git(root, 'rev-parse', 'HEAD');
}

/**
 * {state} is one of:
 *   current     map.commit is HEAD, or nothing under codeRoots changed since
 *   stale       files under codeRoots changed since map.commit
 *   unrecorded  map.json has no commit (made by hand or before 0.3)
 *   unknown     map.commit isn't in this checkout (shallow clone, rewritten history)
 *   starter     folder-based starter map
 *   empty       no map yet
 *   nogit       not a git repo
 */
async function mapStatus(root, config, map) {
    const head = await headCommit(root);
    if (!head) {
        return { state: 'nogit' };
    }
    if (!map.nodes.length) {
        return { state: 'empty', head };
    }
    if (map.starter) {
        return { state: 'starter', head };
    }
    if (!map.commit) {
        return { state: 'unrecorded', head };
    }
    const base = { head, commit: map.commit, evaluatedAt: map.evaluatedAt };
    if (map.commit === head) {
        return { state: 'current', ...base, changed: 0, files: [] };
    }
    const known = await git(root, 'rev-parse', '--verify', '--quiet', `${map.commit}^{commit}`);
    if (!known) {
        return { state: 'unknown', ...base, reason: `Commit ${map.commit.slice(0, 9)} isn’t in this checkout (shallow clone or rewritten history).` };
    }
    const [counts, names] = await Promise.all([
        git(root, 'rev-list', '--left-right', '--count', `${map.commit}...HEAD`),
        git(root, 'diff', '--name-only', map.commit, 'HEAD', ...pathspecs(config)),
    ]);
    const [behindHead, ahead] = (counts || '0 0').split(/\s+/).map(Number);
    const files = names.split('\n').filter(Boolean);
    return {
        state: files.length ? 'stale' : 'current',
        ...base,
        commitsSince: ahead || 0,
        commitsNotInHead: behindHead || 0,
        changed: files.length,
        files: files.slice(0, 50),
        tooBig: files.length > TOO_MANY_FILES,
    };
}

/**
 * The diff an update or review needs: file list with statuses and line counts,
 * plus a size-capped patch. `to` is a commit, or null for the working tree.
 */
async function collectDiff(root, config, from, to = 'HEAD') {
    const spec = pathspecs(config);
    const range = to ? [from, to] : [from];
    const [nameStatus, stat, numstat] = await Promise.all([
        git(root, 'diff', '--name-status', '--find-renames', ...range, ...spec),
        git(root, 'diff', '--stat=120', ...range, ...spec),
        git(root, 'diff', '--numstat', '--find-renames', ...range, ...spec),
    ]);
    const counts = new Map();
    for (const line of numstat.split('\n').filter(Boolean)) {
        const [add, del, ...rest] = line.split('\t');
        // renames print "old => new" (or "dir/{old => new}"); the last name is the new path
        const name = rest.join('\t').replace(/\{[^}]* => ([^}]*)\}/, '$1').replace(/^.* => /, '');
        counts.set(name, { additions: Number(add) || 0, deletions: Number(del) || 0 });
    }
    const files = nameStatus.split('\n').filter(Boolean).map((l) => {
        const [status, ...rest] = l.split('\t');
        const file = rest[rest.length - 1];
        return { status, path: file, from: rest.length > 1 ? rest[0] : undefined, ...counts.get(file) };
    });
    let patch = '';
    const skipped = [];
    for (const f of files) {
        if (/^D/.test(f.status) || /(^|\/)(__tests__|__mocks__|test|tests|fixtures)\/|\.(test|spec)\.|\.(lock|snap|min\.js|map)$|package-lock\.json|pnpm-lock\.yaml|yarn\.lock/.test(f.path)) {
            continue;
        }
        let one = await git(root, 'diff', '--find-renames', '--unified=2', ...range, '--', f.path);
        if (one.length > MAX_FILE_PATCH_BYTES) {
            one = one.slice(0, MAX_FILE_PATCH_BYTES) + `\n… (diff for ${f.path} truncated; read the file for the rest)`;
        }
        if (patch.length + one.length > MAX_PATCH_BYTES) {
            skipped.push(f.path);
            continue;
        }
        patch += one + '\n';
    }
    return { files, stat, patch, skipped };
}

/** Record HEAD as the commit the map describes, without changing anything else. */
async function markCurrent(root) {
    const file = path.join(root, MAP_DIR, 'map.json');
    const map = JSON.parse(await fs.readFile(file, 'utf8'));
    map.commit = await headCommit(root);
    map.evaluatedAt = new Date().toISOString();
    delete map.starter;
    await fs.writeFile(file, JSON.stringify(map, null, 2) + '\n');
    return map.commit;
}

export { TOO_MANY_FILES, collectDiff, headCommit, mapStatus, markCurrent };

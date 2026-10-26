/**
 * Workspaces on disk: `.repo-map/workspace.json` in the home repo lists linked
 * repos, either a live folder (`dir`, read on every request) or an imported map
 * snapshot (`links/<name>.map.json`, no file access). Also: freshness of each
 * repo against its remote's default branch (fetching only when asked), snapshot
 * export/import, and reading files in linked repos through a `<name>:` prefix.
 */
import { execFile } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { MAP_DIR, loadConfig, loadMap } from './config.mjs';
import { cleanMapContracts } from './contracts.mjs';
import { mapStatus } from './freshness.mjs';
import { clampRef, git, readLines } from './repo.mjs';
import { mergeMaps, normalizeWorkspace, validLinkName } from './workspace-map.mjs';

const execFileAsync = promisify(execFile);
const WORKSPACE_FILE = 'workspace.json';
const SNAPSHOT_FORMAT = 'repo-map-snapshot';
const FETCH_TIMEOUT_MS = 60 * 1000;
const REMOTE_URL = /^(https:\/\/|ssh:\/\/|git@)[\w.@:/~+-]+$/;

async function loadWorkspace(root) {
    const file = path.join(root, MAP_DIR, WORKSPACE_FILE);
    if (!existsSync(file)) return normalizeWorkspace({});
    try {
        return normalizeWorkspace(JSON.parse(await fs.readFile(file, 'utf8')));
    } catch (err) {
        throw new Error(`Couldn't parse ${file}: ${err.message}`);
    }
}

async function saveWorkspace(root, raw) {
    const ws = normalizeWorkspace(raw);
    await fs.mkdir(path.join(root, MAP_DIR), { recursive: true });
    await fs.writeFile(path.join(root, MAP_DIR, WORKSPACE_FILE), JSON.stringify(ws, null, 2) + '\n');
    return ws;
}

/** Remote URL without credentials (`https://user:token@host/x` -> `https://host/x`). */
function publicRemote(url) {
    return String(url || '').replace(/^(https?:\/\/)[^@/]+@/, '$1');
}

async function readSnapshot(root, rel) {
    const raw = JSON.parse(await fs.readFile(path.join(root, MAP_DIR, rel), 'utf8'));
    return checkSnapshot(raw);
}

/** A snapshot object, cleaned; throws with a reason when it isn't one. */
function checkSnapshot(raw) {
    if (!raw || raw.format !== SNAPSHOT_FORMAT || !raw.map || !Array.isArray(raw.map.nodes)) {
        throw Object.assign(new Error('That file isn’t a repo-map snapshot. Make one with `repo-map export` in the other repo.'), { status: 400 });
    }
    const map = cleanMapContracts({
        groups: (Array.isArray(raw.map.groups) ? raw.map.groups : []).filter((g) => g && typeof g.id === 'string'),
        nodes: raw.map.nodes.filter((n) => n && typeof n.id === 'string' && typeof n.group === 'string'),
        edges: (Array.isArray(raw.map.edges) ? raw.map.edges : []).filter((e) => e && typeof e.from === 'string' && typeof e.to === 'string'),
    });
    const s = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
    return {
        format: SNAPSHOT_FORMAT,
        version: 1,
        name: s(raw.name, 120),
        remote: publicRemote(s(raw.remote, 400)),
        commit: /^[0-9a-f]{40}$/.test(raw.commit) ? raw.commit : '',
        exportedAt: s(raw.exportedAt, 40),
        map,
    };
}

/**
 * Every link, loaded: { name, source: 'dir'|'snapshot', title, map, root?, config?,
 * snapshot?, error? }. A link that can't be read keeps an `error` and no map.
 */
async function loadLinks(root, ws) {
    const home = path.resolve(root);
    return Promise.all(ws.links.map(async (link) => {
        if (link.dir) {
            const abs = path.resolve(home, link.dir);
            const base = { name: link.name, source: 'dir', dir: link.dir, title: link.name };
            if (abs === home) return { ...base, error: 'This link points at this repo.' };
            if (!existsSync(path.join(abs, MAP_DIR, 'config.json'))) {
                return { ...base, error: `No ${MAP_DIR}/config.json in ${link.dir}. Run repo-map there first.` };
            }
            try {
                const [config, map] = await Promise.all([loadConfig(abs), loadMap(abs)]);
                if (!map.nodes.length) return { ...base, title: config.name, error: 'That repo has no map yet.' };
                return { ...base, title: config.name, root: abs, config, map };
            } catch (err) {
                return { ...base, error: err.message };
            }
        }
        try {
            const snap = await readSnapshot(root, link.snapshot);
            return { name: link.name, source: 'snapshot', title: snap.name || link.name, map: snap.map,
                snapshot: { file: link.snapshot, remote: snap.remote, commit: snap.commit, exportedAt: snap.exportedAt } };
        } catch (err) {
            return { name: link.name, source: 'snapshot', title: link.name, snapshot: { file: link.snapshot }, error: err.message };
        }
    }));
}

/** HEAD against the remote's default branch, from what was last fetched. Never fetches. */
async function remoteStatus(dir, config) {
    const head = await git(dir, 'rev-parse', 'HEAD');
    if (!head) return { state: 'nogit' };
    let ref = await git(dir, 'symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD');
    if (!ref) {
        const guess = `origin/${config.defaultBranch || 'main'}`;
        if (await git(dir, 'rev-parse', '--verify', '--quiet', `${guess}^{commit}`)) ref = guess;
    }
    if (!ref) return { state: 'noremote', head };
    const [counts, fetchHead] = await Promise.all([
        git(dir, 'rev-list', '--left-right', '--count', `${ref}...HEAD`),
        git(dir, 'rev-parse', '--git-path', 'FETCH_HEAD'),
    ]);
    const [behind, ahead] = (counts || '0 0').split(/\s+/).map((n) => Number(n) || 0);
    const stat = fetchHead ? await fs.stat(path.resolve(dir, fetchHead)).catch(() => null) : null;
    return { state: behind ? 'behind' : 'current', head, branch: ref, ahead, behind, fetchedAt: stat ? stat.mtime.toISOString() : null };
}

async function runGit(dir, args) {
    try {
        const { stdout } = await execFileAsync('git', ['-C', dir, ...args], {
            timeout: FETCH_TIMEOUT_MS, maxBuffer: 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        });
        return stdout.trim();
    } catch (err) {
        const why = String(err.stderr || err.message || '').trim().split('\n').pop();
        throw Object.assign(new Error(`git ${args[0]} failed: ${why}`), { status: 502 });
    }
}

/** Map and remote freshness for one checkout. */
async function checkoutFreshness(dir, config, map) {
    const [st, remote] = await Promise.all([mapStatus(dir, config, map), remoteStatus(dir, config)]);
    return {
        map: { state: st.state, commit: st.commit || null, changed: st.changed || 0, commitsSince: st.commitsSince || 0 },
        remote,
    };
}

// Latest remote commit per snapshot remote, from the last Refresh (kept in memory).
const snapshotChecks = new Map();

function snapshotFreshness(snapshot) {
    const check = snapshot.remote ? snapshotChecks.get(snapshot.remote) : null;
    if (!check) return { state: snapshot.remote ? 'unchecked' : 'noremote', exportedAt: snapshot.exportedAt || null, commit: snapshot.commit || null };
    return { state: !snapshot.commit || check.latest !== snapshot.commit ? 'old' : 'current',
        exportedAt: snapshot.exportedAt || null, commit: snapshot.commit || null, latest: check.latest, checkedAt: check.checkedAt };
}

/** Everything the browser needs: workspace.json, each repo with its freshness, and the merged map. */
/**
 * The merged map without freshness checks (no git calls), for traces:
 * { map, links (readable), repos: [{ name, title, readable }], ws }.
 */
async function workspaceMap(root, { config, map } = {}) {
    const [cfg, home, ws] = await Promise.all([config || loadConfig(root), map || loadMap(root), loadWorkspace(root)]);
    const all = await loadLinks(root, ws);
    const merged = mergeMaps(home, all.filter((l) => l.map).map((l) => ({ name: l.name, title: l.title, map: l.map })),
        { seams: ws.seams, columns: cfg.columns.length, homeTitle: cfg.name });
    const repos = [{ name: 'home', title: cfg.name, readable: true },
        ...all.filter((l) => l.map).map((l) => ({ name: l.name, title: l.title, readable: Boolean(l.root) }))];
    return { map: merged, ws, all, repos,
        links: all.filter((l) => l.root).map((l) => ({ name: l.name, root: l.root, config: l.config })) };
}

async function workspaceView(root) {
    const [config, map] = await Promise.all([loadConfig(root), loadMap(root)]);
    const { map: merged, ws, all: links } = await workspaceMap(root, { config, map });
    const repos = [{ name: 'home', title: config.name, source: 'home', readable: true, freshness: await checkoutFreshness(root, config, map) }];
    for (const l of links) {
        const repo = { name: l.name, title: l.title, source: l.source, readable: Boolean(l.root) };
        if (l.dir) repo.dir = l.dir;
        if (l.error) repo.error = l.error;
        if (l.root) repo.freshness = await checkoutFreshness(l.root, l.config, l.map);
        if (l.snapshot) {
            repo.snapshot = l.snapshot;
            if (!l.error) repo.freshness = { snapshot: snapshotFreshness(l.snapshot) };
        }
        repos.push(repo);
    }
    return { workspace: ws, repos, map: merged };
}

/**
 * The opt-in refresh: `git fetch origin` in a checkout, or `git ls-remote` for a
 * snapshot's remote. Returns the repo's new freshness.
 */
async function fetchRepo(root, name) {
    const config = await loadConfig(root);
    if (name === 'home') {
        await runGit(root, ['fetch', '--quiet', '--no-tags', 'origin']);
        return checkoutFreshness(root, config, await loadMap(root));
    }
    const ws = await loadWorkspace(root);
    const link = (await loadLinks(root, ws)).find((l) => l.name === name);
    if (!link) throw Object.assign(new Error(`No linked repo named ${name}.`), { status: 404 });
    if (link.error) throw Object.assign(new Error(link.error), { status: 409 });
    if (link.root) {
        await runGit(link.root, ['fetch', '--quiet', '--no-tags', 'origin']);
        return checkoutFreshness(link.root, link.config, link.map);
    }
    const remote = link.snapshot.remote;
    if (!remote || !REMOTE_URL.test(remote)) {
        throw Object.assign(new Error('This snapshot has no remote to check against.'), { status: 409 });
    }
    const out = await runGit(root, ['ls-remote', remote, 'HEAD']);
    const latest = (out.match(/^[0-9a-f]{40}/) || [''])[0];
    if (!latest) throw Object.assign(new Error('The remote returned no HEAD commit.'), { status: 502 });
    snapshotChecks.set(remote, { latest, checkedAt: new Date().toISOString() });
    return { snapshot: snapshotFreshness(link.snapshot) };
}

/** What `repo-map export` writes: the map plus where and when it came from. */
async function exportSnapshot(root) {
    const [config, map, remote, head] = await Promise.all([loadConfig(root), loadMap(root),
        git(root, 'remote', 'get-url', 'origin'), git(root, 'rev-parse', 'HEAD')]);
    return {
        format: SNAPSHOT_FORMAT,
        version: 1,
        name: config.name,
        remote: publicRemote(remote),
        commit: map.commit || head || '',
        exportedAt: new Date().toISOString(),
        map: { groups: map.groups, nodes: map.nodes, edges: map.edges },
    };
}

/** Save an uploaded snapshot as links/<name>.map.json and link it (replacing a link of that name). */
async function importSnapshot(root, name, raw) {
    if (!validLinkName(name)) {
        throw Object.assign(new Error('Link names are 2-31 lowercase letters, digits or dashes, starting with a letter.'), { status: 400 });
    }
    const snap = checkSnapshot(raw);
    const rel = `links/${name}.map.json`;
    await fs.mkdir(path.join(root, MAP_DIR, 'links'), { recursive: true });
    await fs.writeFile(path.join(root, MAP_DIR, rel), JSON.stringify(snap, null, 2) + '\n');
    const ws = await loadWorkspace(root);
    return saveWorkspace(root, { ...ws, links: [...ws.links.filter((l) => l.name !== name), { name, snapshot: rel }] });
}

/** Live linked repos the AI and file viewer may read: [{ name, root, config }]. */
async function readableLinks(root) {
    const links = await loadLinks(root, await loadWorkspace(root));
    return links.filter((l) => l.root).map((l) => ({ name: l.name, root: l.root, config: l.config }));
}

const LINKED_PATH = /^([a-z][a-z0-9-]{1,30}):(.+)$/;

/**
 * readLines, but `<name>:path` reads inside that linked repo (its codeRoots and
 * docs, same exclusions). The returned `clean` keeps the prefix.
 */
async function readWorkspaceLines(root, config, rel, links) {
    const m = String(rel || '').match(LINKED_PATH);
    if (m) {
        const link = (links || await readableLinks(root)).find((l) => l.name === m[1]);
        if (link) {
            const out = await readLines(link.root, link.config, m[2]);
            return { ...out, clean: `${link.name}:${out.clean}` };
        }
    }
    return readLines(root, config, rel);
}

/** clampRef for workspace paths. */
async function clampWorkspaceRef(root, config, ref, links) {
    const m = String(ref?.path || '').match(LINKED_PATH);
    const link = m && links.find((l) => l.name === m[1]);
    if (!link) return clampRef(root, config, ref);
    const out = await clampRef(link.root, link.config, { ...ref, path: m[2] });
    return out && { ...out, path: `${link.name}:${out.path}` };
}

export { SNAPSHOT_FORMAT, WORKSPACE_FILE, checkSnapshot, clampWorkspaceRef, exportSnapshot, fetchRepo, importSnapshot, loadLinks,
    loadWorkspace, publicRemote, readWorkspaceLines, readableLinks, remoteStatus, saveWorkspace, workspaceMap, workspaceView };

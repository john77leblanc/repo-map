/**
 * Creating and updating .repo-map/ without hand-editing: the starter config,
 * and a no-AI starter map built from the folder structure.
 */
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAP_DIR } from './config.mjs';
import { git, githubFromRemote } from './repo.mjs';

const PKG_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const GITIGNORE = 'traces/\nlocal.json\nmap.draft.json\nmap.prev.json\nmap.raw.txt\n';
const CANDIDATE_ROOTS = ['src', 'app', 'apps', 'pages', 'components', 'lib', 'services', 'packages', 'server', 'client', 'api', 'cmd', 'internal', 'pkg'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', '__tests__', '__mocks__', 'test', 'tests', 'fixtures']);

function normaliseRoots(list) {
    return list.map((r) => String(r).trim()).filter(Boolean).map((r) => r.replace(/^\.?\/+/, '').replace(/\/?$/, '/'));
}

/** What `init` would pick for a repo, before any answers or flags. */
async function detectDefaults(root) {
    const remote = await git(root, 'remote', 'get-url', 'origin');
    const roots = CANDIDATE_ROOTS.filter((d) => existsSync(path.join(root, d)));
    let name = path.basename(root);
    try {
        const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
        name = (pkg.name || name).replace(/^@[^/]+\//, '');
    } catch {
        // no package.json: keep the folder name
    }
    return { name: `${name} map`, codeRoots: normaliseRoots(roots.length ? roots : ['.']), github: githubFromRemote(remote) };
}

/**
 * Create .repo-map/config.json (or merge `patch` into an existing one).
 * Returns { created, updated, config, file }.
 */
async function writeConfig(root, patch = {}) {
    const dir = path.join(root, MAP_DIR);
    const file = path.join(dir, 'config.json');
    await fs.mkdir(dir, { recursive: true });
    if (!existsSync(path.join(dir, '.gitignore'))) {
        await fs.writeFile(path.join(dir, '.gitignore'), GITIGNORE);
    }
    const merge = (base) => ({ ...base, ...patch, ...(patch.prompt ? { prompt: { ...(base.prompt || {}), ...patch.prompt } } : {}) });
    if (existsSync(file)) {
        if (!Object.keys(patch).length) {
            return { created: false, updated: false, file, config: JSON.parse(await fs.readFile(file, 'utf8')) };
        }
        const config = merge(JSON.parse(await fs.readFile(file, 'utf8')));
        await fs.writeFile(file, JSON.stringify(config, null, 4) + '\n');
        return { created: false, updated: true, file, config };
    }
    const template = JSON.parse(await fs.readFile(path.join(PKG_DIR, 'templates', 'config.json'), 'utf8'));
    const config = merge({ ...template, ...(await detectDefaults(root)) });
    await fs.writeFile(file, JSON.stringify(config, null, 4) + '\n');
    return { created: true, updated: false, file, config };
}

/**
 * A map built from folders alone: one group per code root, one node per
 * sub-folder (or the root itself if it has none). No connections, no AI.
 */
async function starterMap(root, config) {
    const groups = [];
    const nodes = [];
    const used = new Set();
    const idFor = (s) => {
        let base = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'root';
        let id = base;
        for (let i = 2; used.has(id); i++) {
            id = `${base}-${i}`;
        }
        used.add(id);
        return id;
    };
    const midCol = Math.min(2, Math.max(0, config.columns.length - 1));
    for (const codeRoot of config.codeRoots) {
        const rel = codeRoot === './' ? '' : codeRoot.replace(/\/$/, '');
        const abs = path.join(root, rel);
        let entries = [];
        try {
            entries = (await fs.readdir(abs, { withFileTypes: true }))
                .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name) && !config.blocked.includes(e.name))
                .map((e) => e.name)
                .sort();
        } catch {
            continue;
        }
        const gid = `g-${idFor(rel || 'repo')}`;
        groups.push({ id: gid, col: midCol, title: rel || path.basename(root), open: entries.length <= 12 });
        const folders = entries.length ? entries : [null];
        for (const name of folders.slice(0, 60)) {
            const p = name ? (rel ? `${rel}/${name}` : name) : rel || '.';
            nodes.push({ id: idFor(name || rel || 'repo'), group: gid, kind: 'service', path: p, title: name || rel || 'repo', desc: `Folder ${p}. Describe what it does here, or redraw the map with an AI tool from Settings.` });
        }
    }
    return { generatedAt: new Date().toISOString(), starter: true, groups, nodes, edges: [] };
}

export { CANDIDATE_ROOTS, GITIGNORE, detectDefaults, normaliseRoots, starterMap, writeConfig };

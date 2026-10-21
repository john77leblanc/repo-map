/**
 * Loads a repo's .repo-map/ folder: config.json (how to read the repo) and
 * map.json (the drawn graph). Fills defaults so older or minimal configs work.
 */
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';

const MAP_DIR = '.repo-map';

const DEFAULT_CONFIG = {
    name: 'Repo Map',
    description: '',
    github: '',
    defaultBranch: 'main',
    codeRoots: ['src/'],
    blocked: ['node_modules', '.git', 'dist', 'build', '.next', 'coverage'],
    columns: [
        { title: 'Outside world', subtitle: 'Users, content & vendors that start flows' },
        { title: 'Entry points', subtitle: 'Code that receives outside traffic' },
        { title: 'Core', subtitle: 'Shared state, events and APIs' },
        { title: 'Workers', subtitle: 'Consumers & jobs by area' },
        { title: 'Downstream', subtitle: 'Systems the data ends up in' },
    ],
    kinds: {
        service: 'service',
        topic: 'topic',
        external: 'outside the repo',
    },
    edgeTypes: {
        http: 'HTTP call',
        event: 'Event',
        sync: 'Data sync / job',
    },
    prompt: {
        context: '',
        hints: '',
    },
    footnote: '',
    tracesDir: '.repo-map/traces',
    claude: {
        bin: 'claude',
        model: '',
        maxTurns: 40,
        timeoutMs: 10 * 60 * 1000,
    },
};

/** Walk up from `start` until a folder containing .repo-map/ is found. */
function findRepoRoot(start) {
    let dir = path.resolve(start);
    for (;;) {
        if (existsSync(path.join(dir, MAP_DIR))) {
            return dir;
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            return null;
        }
        dir = parent;
    }
}

function withDefaults(raw) {
    const cfg = { ...DEFAULT_CONFIG, ...raw };
    cfg.kinds = { ...DEFAULT_CONFIG.kinds, ...(raw.kinds || {}) };
    cfg.edgeTypes = { ...DEFAULT_CONFIG.edgeTypes, ...(raw.edgeTypes || {}) };
    cfg.prompt = { ...DEFAULT_CONFIG.prompt, ...(raw.prompt || {}) };
    cfg.claude = { ...DEFAULT_CONFIG.claude, ...(raw.claude || {}) };
    // Environment overrides, handy for one-off runs and CI
    cfg.claude.bin = process.env.REPO_MAP_CLAUDE_BIN || cfg.claude.bin;
    cfg.claude.model = process.env.REPO_MAP_MODEL || cfg.claude.model;
    cfg.codeRoots = (cfg.codeRoots || []).map((r) => r.replace(/^\.?\/+/, '').replace(/\/?$/, '/'));
    return cfg;
}

async function readJson(file) {
    return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function loadConfig(root) {
    const file = path.join(root, MAP_DIR, 'config.json');
    if (!existsSync(file)) {
        throw new Error(`No ${MAP_DIR}/config.json in ${root}. Run \`repo-map init\` first.`);
    }
    return withDefaults(await readJson(file));
}

async function loadMap(root) {
    const file = path.join(root, MAP_DIR, 'map.json');
    if (!existsSync(file)) {
        return { groups: [], nodes: [], edges: [] };
    }
    const map = await readJson(file);
    return {
        groups: Array.isArray(map.groups) ? map.groups : [],
        nodes: Array.isArray(map.nodes) ? map.nodes : [],
        edges: Array.isArray(map.edges) ? map.edges : [],
        generatedAt: map.generatedAt || null,
    };
}

export { DEFAULT_CONFIG, MAP_DIR, findRepoRoot, loadConfig, loadMap, readJson, withDefaults };

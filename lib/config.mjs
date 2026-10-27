/**
 * Loads a repo's .repo-map/ folder: config.json (how to read the repo, committed)
 * and map.json (the drawn graph, committed). AI settings are layered so each
 * person can use their own tool without changing the shared config:
 *
 *   defaults < config.json "ai" < ~/.config/repo-map/ai.json < .repo-map/local.json < env vars
 *
 * "provider" / "effort" are the defaults for traces; "generate" overrides them
 * for drawing and updating the map (empty fields fall back to the trace defaults).
 */
import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAP_DIR = '.repo-map';
const PROVIDERS = ['auto', 'claude', 'codex', 'gemini', 'command', 'api', 'ollama', 'lmstudio', 'none'];
// Agents that take a per-agent model setting (ai.<id>.model)
const MODEL_BLOCKS = ['claude', 'codex', 'gemini', 'command', 'api', 'ollama', 'lmstudio'];

const DEFAULT_AI = {
    provider: 'auto',
    effort: '',
    generate: { provider: '', model: '', effort: '' },
    classify: { model: '', effort: '' },
    timeoutMs: 10 * 60 * 1000,
    claude: {
        bin: 'claude',
        model: '',
        maxTurns: 40,
    },
    codex: { bin: '', model: '' },
    gemini: { bin: '', model: '' },
    ollama: { baseUrl: 'http://localhost:11434/v1', model: '' },
    lmstudio: { baseUrl: 'http://localhost:1234/v1', model: '' },
    command: {
        label: '',
        bin: '',
        args: [],
        promptVia: 'stdin',
    },
    api: {
        baseUrl: 'https://api.openai.com/v1',
        model: '',
        apiKeyEnv: 'REPO_MAP_API_KEY',
        maxTurns: 30,
    },
};

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
    // Documents the docs pass links to cards (docs.mjs). Readable even outside codeRoots.
    docs: {
        include: ['**/*.md', '**/*.mdx', '**/*.rst', '**/*.adoc'],
        exclude: ['CHANGELOG.md', '**/CHANGELOG.md'],
        comments: true,
        maxFiles: 200,
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

function isObject(v) {
    return v && typeof v === 'object' && !Array.isArray(v);
}

/** Merge plain objects; arrays and scalars replace. */
function deepMerge(base, ...layers) {
    const out = { ...base };
    for (const layer of layers) {
        if (!isObject(layer)) {
            continue;
        }
        for (const [k, v] of Object.entries(layer)) {
            out[k] = isObject(v) && isObject(out[k]) ? deepMerge(out[k], v) : v;
        }
    }
    return out;
}

function envLayer(env = process.env) {
    const layer = {};
    if (env.REPO_MAP_AI_PROVIDER) {
        layer.provider = env.REPO_MAP_AI_PROVIDER;
    }
    if (env.REPO_MAP_CLAUDE_BIN) {
        layer.claude = { bin: env.REPO_MAP_CLAUDE_BIN };
    }
    if (env.REPO_MAP_API_BASE_URL) {
        layer.api = { ...(layer.api || {}), baseUrl: env.REPO_MAP_API_BASE_URL };
    }
    if (env.REPO_MAP_MODEL) {
        // applies to whichever provider ends up running
        layer.model = env.REPO_MAP_MODEL;
    }
    if (env.REPO_MAP_EFFORT) {
        layer.effort = env.REPO_MAP_EFFORT;
    }
    // A provider, model or effort chosen for this run (flags or env) applies to every task,
    // so it also replaces a saved "generate" choice.
    if (env.REPO_MAP_AI_PROVIDER || env.REPO_MAP_MODEL || env.REPO_MAP_EFFORT) {
        layer.generate = env.REPO_MAP_AI_PROVIDER
            ? { provider: '', model: '', effort: '' }
            : { ...(env.REPO_MAP_MODEL ? { model: '' } : {}), ...(env.REPO_MAP_EFFORT ? { effort: '' } : {}) };
    }
    return layer;
}

/**
 * Build the effective AI settings. `layers` are already-parsed JSON objects
 * (config.json "ai", global file, local file); env vars are applied last.
 * 0.1.x configs used a top-level "claude" block; it is still honoured.
 */
function resolveAi({ legacyClaude, repoAi, globalAi, localAi, env = process.env } = {}) {
    const legacy = isObject(legacyClaude)
        ? { claude: { bin: legacyClaude.bin, model: legacyClaude.model, maxTurns: legacyClaude.maxTurns }, timeoutMs: legacyClaude.timeoutMs }
        : {};
    const clean = (o) => JSON.parse(JSON.stringify(o)); // drops undefined
    const ai = deepMerge(DEFAULT_AI, clean(legacy), repoAi, globalAi, localAi, envLayer(env));
    if (ai.model) {
        for (const k of MODEL_BLOCKS) {
            ai[k] = { ...ai[k], model: ai.model };
        }
        delete ai.model;
    }
    if (!PROVIDERS.includes(ai.provider)) {
        ai.invalidProvider = ai.provider;
        ai.provider = 'none';
    }
    ai.effort = typeof ai.effort === 'string' ? ai.effort : '';
    const c = isObject(ai.classify) ? ai.classify : {};
    ai.classify = { model: typeof c.model === 'string' ? c.model : '', effort: typeof c.effort === 'string' ? c.effort : '' };
    const g = isObject(ai.generate) ? ai.generate : {};
    ai.generate = {
        provider: PROVIDERS.includes(g.provider) ? g.provider : '',
        model: typeof g.model === 'string' ? g.model : '',
        effort: typeof g.effort === 'string' ? g.effort : '',
    };
    return ai;
}

function withDefaults(raw = {}, aiLayers = {}) {
    const cfg = deepMerge(DEFAULT_CONFIG, raw);
    cfg.codeRoots = (cfg.codeRoots || []).map((r) => r.replace(/^\.?\/+/, '').replace(/\/?$/, '/'));
    cfg.ai = resolveAi({ legacyClaude: raw.claude, repoAi: raw.ai, ...aiLayers });
    delete cfg.claude;
    return cfg;
}

async function readJson(file) {
    return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function readJsonIfExists(file) {
    if (!existsSync(file)) {
        return undefined;
    }
    try {
        return await readJson(file);
    } catch (err) {
        throw new Error(`Couldn't parse ${file}: ${err.message}`);
    }
}

function globalAiFile(env = process.env) {
    const base = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    return path.join(base, 'repo-map', 'ai.json');
}

async function loadConfig(root) {
    const file = path.join(root, MAP_DIR, 'config.json');
    if (!existsSync(file)) {
        throw new Error(`No ${MAP_DIR}/config.json in ${root}. Run \`repo-map init\` first.`);
    }
    const [raw, globalAi, localFile] = await Promise.all([
        readJson(file),
        readJsonIfExists(globalAiFile()),
        readJsonIfExists(path.join(root, MAP_DIR, 'local.json')),
    ]);
    // local.json may hold AI settings flat; `workspace` (which links are off) isn't one
    const { workspace, ...localFlat } = localFile || {};
    return withDefaults(raw, { globalAi, localAi: localFile && (localFile.ai || localFlat) });
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
        starter: Boolean(map.starter),
        commit: typeof map.commit === 'string' ? map.commit : null,
        evaluatedAt: map.evaluatedAt || map.updatedAt || map.generatedAt || null,
    };
}

export { DEFAULT_AI, DEFAULT_CONFIG, MAP_DIR, PROVIDERS, deepMerge, findRepoRoot, globalAiFile, loadConfig, loadMap, readJson, resolveAi, withDefaults };

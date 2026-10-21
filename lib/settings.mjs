/**
 * Writes AI settings for `repo-map ai …`, so choosing a tool is one command
 * instead of hand-editing JSON. Existing keys in the target file are kept.
 */
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { MAP_DIR, deepMerge, globalAiFile } from './config.mjs';

// Shortcuts → the settings they stand for
const AI_PRESETS = {
    auto: () => ({ provider: 'auto' }),
    none: () => ({ provider: 'none' }),
    claude: (o) => ({ provider: 'claude', claude: clean({ model: o.model, bin: o.bin }) }),
    api: (o) => ({ provider: 'api', api: clean({ model: o.model, baseUrl: o.baseUrl, apiKeyEnv: o.keyEnv }) }),
    openai: (o) => ({ provider: 'api', api: clean({ model: o.model, baseUrl: o.baseUrl || 'https://api.openai.com/v1', apiKeyEnv: o.keyEnv }) }),
    ollama: (o) => ({ provider: 'api', api: clean({ model: o.model, baseUrl: o.baseUrl || 'http://localhost:11434/v1' }) }),
    lmstudio: (o) => ({ provider: 'api', api: clean({ model: o.model, baseUrl: o.baseUrl || 'http://localhost:1234/v1' }) }),
    codex: (o) => ({ provider: 'command', command: clean({ preset: 'codex', bin: o.bin, model: o.model }) }),
    gemini: (o) => ({ provider: 'command', command: clean({ preset: 'gemini', bin: o.bin, model: o.model }) }),
    command: (o) => ({ provider: 'command', command: clean({ bin: o.bin, args: o.args, label: o.label }) }),
};

function clean(obj) {
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== ''));
}

function settingsFile(root, scope) {
    if (scope === 'global') {
        return globalAiFile();
    }
    if (!root) {
        throw new Error(`--${scope} needs a repo with ${MAP_DIR}/ (run repo-map init first, or use --global)`);
    }
    return path.join(root, MAP_DIR, scope === 'repo' ? 'config.json' : 'local.json');
}

/** Merge `patch` into the AI settings stored at `scope`. Returns { file, written }. */
async function writeAiSettings({ root, scope, patch }) {
    const file = settingsFile(root, scope);
    let current = {};
    if (existsSync(file)) {
        current = JSON.parse(await fs.readFile(file, 'utf8'));
    }
    let next;
    if (scope === 'repo') {
        // config.json holds the whole repo config; AI settings live under "ai"
        next = { ...current, ai: deepMerge(current.ai || {}, patch) };
        delete next.claude; // superseded by "ai"
    } else {
        next = deepMerge(current, patch);
    }
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(next, null, 4) + '\n');
    return { file, written: scope === 'repo' ? next.ai : next };
}

export { AI_PRESETS, settingsFile, writeAiSettings };

/**
 * Every AI agent repo-map can run, the models and effort levels each offers,
 * and which agent, model and effort a task uses.
 *
 *   listAgents(config)                        every agent found on this machine (cached briefly)
 *   resolveSelection(config, { task, pick })  -> { agent, model, effort, label }
 *   runSelection(selection, common)           -> { promise, kill }
 *
 * `task` is "trace" (traces and flowcharts) or "generate" (drawing and updating
 * the map). A `pick` ({ agent, model, effort }) comes from the browser or the
 * CLI. It can only choose among detected agents and their effort levels; it
 * never sets a binary, arguments or a URL.
 */
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apiKey, apiLabel, isLocal, listModels, runApi } from './api.mjs';
import { LABEL as CLAUDE_LABEL, runClaude } from './claude.mjs';
import { commandSettings, runCommand } from './command.mjs';
import { which } from './which.mjs';
import { responsePrompt } from '../response-contracts.mjs';

// Used when a tool can't tell us. ai.<agent>.models / ai.<agent>.efforts override them.
const CLAUDE_MODELS = ['opus', 'sonnet', 'haiku'];
const CLAUDE_EFFORTS = ['low', 'medium', 'high'];
const CODEX_EFFORTS = ['low', 'medium', 'high'];
const GEMINI_MODELS = ['gemini-2.5-pro', 'gemini-2.5-flash'];
const API_EFFORTS = ['low', 'medium', 'high'];
const LOCAL_LABELS = { ollama: 'Ollama', lmstudio: 'LM Studio' };

const AUTO_ORDER = ['claude', 'api', 'command', 'codex', 'gemini', 'ollama', 'lmstudio'];
const MODEL_ID = /^[\w.:/@+-]{1,120}$/;
const EFFORT_ID = /^[\w-]{1,32}$/;
const CACHE_MS = 60 * 1000;
const PROBE_MS = 2500;

const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : null);
const named = (list) => list.map((id) => ({ id }));
/** ai.<agent>.models may be ["id", …] or [{ id, label, efforts }, …]. */
function modelList(v) {
    if (!Array.isArray(v)) {
        return null;
    }
    return v.map((m) => (typeof m === 'string' ? { id: m } : m && typeof m.id === 'string' ? { id: m.id, label: m.label, efforts: strings(m.efforts) || undefined } : null))
        .filter((m) => m && MODEL_ID.test(m.id));
}
const sameUrl = (a, b) => String(a || '').replace(/\/+$/, '') === String(b || '').replace(/\/+$/, '');

/** A CLI's --help text, or '' when it can't be run quickly. */
function helpText(bin) {
    return new Promise((resolve) => {
        let out = '';
        let child;
        try {
            child = spawn(bin, ['--help'], { stdio: ['ignore', 'pipe', 'ignore'] });
        } catch {
            resolve('');
            return;
        }
        const timer = setTimeout(() => child.kill(), 5000);
        child.stdout.on('data', (d) => {
            out += d;
        });
        child.on('error', () => resolve(''));
        child.on('close', () => {
            clearTimeout(timer);
            resolve(out);
        });
    });
}

/** Model aliases and effort levels as Claude Code's --help describes them. */
function parseClaudeHelp(text) {
    const effort = /--effort\s+<\w+>[\s\S]*?\(([^)]*)\)/.exec(text);
    const model = /--model\s+<\w+>[\s\S]*?e\.g\.([^)]*)\)/.exec(text);
    return {
        efforts: effort ? effort[1].split(/[\s,]+/).filter((w) => /^[a-z]+$/.test(w) && w !== 'or') : [],
        models: model ? [...model[1].matchAll(/'([\w.-]+)'/g)].map((m) => m[1]) : [],
    };
}

/** Codex keeps the models your account can use, with their effort levels, in a local cache. */
async function codexModels(env = process.env) {
    const file = path.join(env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'models_cache.json');
    try {
        const data = JSON.parse(await fs.readFile(file, 'utf8'));
        return (Array.isArray(data.models) ? data.models : [])
            .filter((m) => m && typeof m.slug === 'string' && MODEL_ID.test(m.slug) && m.visibility !== 'hide')
            .map((m) => ({
                id: m.slug,
                label: m.display_name || undefined,
                efforts: (m.supported_reasoning_levels || []).map((l) => l && l.effort).filter((e) => typeof e === 'string' && EFFORT_ID.test(e)),
            }));
    } catch {
        return null;
    }
}

async function claudeAgent(ai) {
    const s = ai.claude;
    const base = { id: 'claude', kind: 'claude', label: CLAUDE_LABEL, settings: s, defaultModel: s.model || '', models: [], efforts: [] };
    const found = await which(s.bin);
    if (!found) {
        return { ...base, available: false, reason: `Claude Code isn’t installed (\`${s.bin}\` not found on PATH).` };
    }
    const help = parseClaudeHelp(await helpText(found));
    return {
        ...base,
        available: true,
        detail: found,
        models: modelList(s.models) || named([...new Set([...help.models, ...CLAUDE_MODELS])]),
        efforts: strings(s.efforts) || (help.efforts.length ? help.efforts : CLAUDE_EFFORTS),
    };
}

/** Codex/Gemini settings. Before 0.5 they lived under "command" with a preset; that still works. */
function presetSettings(ai, id) {
    const legacy = ai.command && ai.command.preset === id ? ai.command : {};
    const { models, efforts, ...own } = ai[id] || {};
    const set = Object.fromEntries(Object.entries(own).filter(([, v]) => v !== '' && v !== undefined));
    return commandSettings({ ...legacy, ...set, preset: id });
}

async function cliAgent(ai, id) {
    const s = presetSettings(ai, id);
    const base = { id, kind: 'command', label: s.label, settings: s, defaultModel: s.model || '', models: [], efforts: [] };
    const found = await which(s.bin);
    if (!found) {
        return { ...base, available: false, reason: `${s.label} isn’t installed (\`${s.bin}\` not found on PATH).` };
    }
    const own = ai[id] || {};
    const models = id === 'codex'
        ? modelList(own.models) || (await codexModels()) || []
        : modelList(own.models) || named(GEMINI_MODELS);
    const efforts = strings(own.efforts) || (id === 'codex' ? CODEX_EFFORTS : []);
    return { ...base, available: true, detail: found, models, efforts };
}

/** A custom CLI from ai.command (one that isn't the codex/gemini preset). */
async function commandAgent(ai) {
    const raw = ai.command || {};
    if (!raw.bin || raw.preset === 'codex' || raw.preset === 'gemini') {
        return null;
    }
    const s = commandSettings(raw);
    const base = { id: 'command', kind: 'command', label: s.label, settings: s, defaultModel: s.model || '', models: modelList(raw.models) || [], efforts: strings(raw.efforts) || [] };
    const found = await which(s.bin);
    return found
        ? { ...base, available: true, detail: found }
        : { ...base, available: false, reason: `${s.label} isn’t installed (\`${s.bin}\` not found on PATH).` };
}

/** The configured OpenAI-compatible API. Listed once it has a model or a key (or the provider says api). */
async function apiAgent(ai) {
    const s = ai.api;
    const key = apiKey(s);
    const local = isLocal(s);
    if (!s.model && !key && ai.provider !== 'api') {
        return null;
    }
    const base = { id: 'api', kind: 'api', label: apiLabel({ ...s, model: 'API' }), settings: s, defaultModel: s.model || '', models: s.model ? named([s.model]) : [], efforts: strings(s.efforts) || (local ? [] : API_EFFORTS) };
    if (!key && !local) {
        return { ...base, available: false, reason: `No API key in ${s.apiKeyEnv}.` };
    }
    let listed = [];
    try {
        listed = await listModels(s, PROBE_MS);
    } catch {
        // unreachable or refused: keep the configured model; the run reports the cause
    }
    const models = modelList(s.models) || named([...new Set([...(s.model ? [s.model] : []), ...listed])]);
    if (!models.length) {
        return { ...base, available: false, reason: 'ai.api.model isn’t set, and the server didn’t list any models.' };
    }
    return { ...base, available: true, detail: s.baseUrl, models };
}

/** Ollama / LM Studio: available when their local server answers with at least one model. */
async function localAgent(ai, id) {
    const own = ai[id] || {};
    if (sameUrl(own.baseUrl, ai.api.baseUrl)) {
        return null; // the api entry already points here
    }
    const label = LOCAL_LABELS[id];
    const settings = { baseUrl: own.baseUrl, model: own.model || '', apiKeyEnv: own.apiKeyEnv || '', maxTurns: own.maxTurns || ai.api.maxTurns };
    const base = { id, kind: 'api', label, settings, defaultModel: settings.model, models: [], efforts: strings(own.efforts) || [] };
    const configured = ai.provider === id || ai.generate.provider === id || Boolean(own.model);
    try {
        const listed = await listModels(settings, PROBE_MS);
        if (!listed.length) {
            return { ...base, available: false, reason: `${label} is running but has no models${id === 'ollama' ? '. Pull one with `ollama pull <model>`' : '. Load one in LM Studio'}.` };
        }
        return { ...base, available: true, detail: own.baseUrl, models: modelList(own.models) || named(listed) };
    } catch {
        return configured ? { ...base, available: false, reason: `${label} isn’t running (nothing answered at ${own.baseUrl}).` } : null;
    }
}

const cache = new Map();

/** Every agent repo-map knows how to run, found or configured on this machine. */
function listAgents(config, { refresh = false } = {}) {
    const ai = config.ai;
    const key = JSON.stringify([ai, process.env.PATH, process.env.CODEX_HOME, Boolean(apiKey(ai.api))]);
    const hit = cache.get(key);
    if (hit && !refresh && Date.now() - hit.at < CACHE_MS) {
        return hit.agents;
    }
    const agents = Promise.all([
        claudeAgent(ai), cliAgent(ai, 'codex'), cliAgent(ai, 'gemini'), apiAgent(ai),
        localAgent(ai, 'ollama'), localAgent(ai, 'lmstudio'), commandAgent(ai),
    ]).then((list) => list.filter(Boolean));
    cache.set(key, { at: Date.now(), agents });
    agents.catch(() => cache.delete(key));
    return agents;
}

/** What the browser may see: no settings, paths or keys. */
function publicAgent(a) {
    return {
        id: a.id,
        label: a.label,
        available: a.available,
        reason: a.reason || '',
        models: a.models.map((m) => ({ id: m.id, ...(m.label ? { label: m.label } : {}), ...(m.efforts ? { efforts: m.efforts } : {}) })),
        efforts: a.efforts,
        defaultModel: a.defaultModel || '',
    };
}

function effortsFor(agent, model) {
    const m = agent.models.find((x) => x.id === model);
    return (m && m.efforts) || agent.efforts;
}

/** Which agent a provider setting names. "command" with a codex/gemini preset is that agent. */
function agentIdFor(ai, provider) {
    if (provider === 'command' && (ai.command.preset === 'codex' || ai.command.preset === 'gemini')) {
        return ai.command.preset;
    }
    return provider;
}

function failure(message, code, extra = {}) {
    return Object.assign(new Error(message), { code, ...extra });
}

/**
 * The agent, model and effort for a task. Throws code "pick" for a bad pick
 * (the caller's fault) and "unavailable" when no usable agent is set up.
 */
async function resolveSelection(config, { task = 'trace', pick = {} } = {}) {
    const ai = config.ai;
    const g = task === 'generate' ? ai.generate : { provider: '', model: '', effort: '' };
    const agents = await listAgents(config);
    const byId = Object.fromEntries(agents.map((a) => [a.id, a]));
    const picked = (k) => typeof pick[k] === 'string' && pick[k] !== '';

    // "none" turns AI off for the task, picks included
    const provider = g.provider || ai.provider;
    if (ai.invalidProvider && !g.provider) {
        throw failure(`Unknown ai.provider "${ai.invalidProvider}". Use auto, claude, codex, gemini, api, ollama, lmstudio, command or none.`, 'unavailable');
    }
    if (provider === 'none') {
        throw failure('AI is turned off (ai.provider is "none").', 'unavailable');
    }

    let agent;
    let auto = false;
    if (picked('agent')) {
        agent = byId[pick.agent];
        if (!agent) {
            throw failure(`“${pick.agent}” isn’t an AI tool repo-map found on this machine.`, 'pick');
        }
        if (!agent.available) {
            throw failure(agent.reason, 'pick');
        }
    } else {
        if (provider === 'auto') {
            auto = true;
            agent = AUTO_ORDER.map((id) => byId[id]).find((a) => a && a.available);
            if (!agent) {
                const tried = agents.map((a) => a.reason).filter(Boolean);
                throw failure(`No AI tool found. ${tried[0] || ''}`.trim(), 'unavailable', { tried });
            }
        } else {
            const id = agentIdFor(ai, provider);
            agent = byId[id];
            if (!agent) {
                const why = id === 'command' ? 'ai.command.bin (or ai.command.preset) isn’t set.' : id === 'api' ? 'ai.api.model isn’t set.' : `${LOCAL_LABELS[id] || id} isn’t set up.`;
                throw failure(why, 'unavailable', { agentId: id });
            }
            if (!agent.available) {
                throw failure(agent.reason, 'unavailable', { agentId: id, label: agent.label });
            }
        }
    }

    const sameAsDefault = !picked('agent');
    let model = picked('model') ? pick.model : (sameAsDefault && g.model) || agent.defaultModel || '';
    if (!model && agent.kind === 'api') {
        model = agent.models[0] ? agent.models[0].id : '';
        if (!model) {
            throw failure(`No model is set for ${agent.label}.`, 'unavailable', { agentId: agent.id });
        }
    }
    if (model && (!MODEL_ID.test(model) || model.startsWith('-'))) {
        throw failure(`“${model}” isn’t a valid model id.`, picked('model') ? 'pick' : 'unavailable');
    }

    let effort = picked('effort') ? pick.effort : g.effort || ai.effort || '';
    const allowed = effortsFor(agent, model);
    if (effort && (!EFFORT_ID.test(effort) || !allowed.includes(effort))) {
        if (picked('effort')) {
            throw failure(allowed.length
                ? `${agent.label}${model ? ` (${model})` : ''} doesn’t offer effort “${effort}”. Choose ${allowed.join(', ')}.`
                : `${agent.label} has no effort setting.`, 'pick');
        }
        effort = ''; // a saved default that doesn't fit this agent: use the tool's own default
    }

    const label = agent.kind === 'api' && agent.id === 'api'
        ? [apiLabel({ ...agent.settings, model }), effort].filter(Boolean).join(' · ')
        : [agent.label, model, effort].filter(Boolean).join(' · ');
    return { agent, model, effort, label, auto };
}

/** Start a run with a resolved selection. `common` is { root, config, prompt, onProgress, maxTurns, timeoutMs }. */
function runSelection({ agent, model, effort }, common) {
    const settings = { ...agent.settings, model, effort };
    common = { ...common, prompt: responsePrompt(common.prompt, common.responseSchema) };
    switch (agent.kind) {
        case 'claude': return runClaude({ ...common, settings });
        case 'command': return runCommand({ ...common, settings });
        default: return runApi({ ...common, settings });
    }
}

export { agentIdFor, codexModels, effortsFor, listAgents, parseClaudeHelp, publicAgent, resolveSelection, runSelection };

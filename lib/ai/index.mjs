/**
 * Picks which AI agent runs a task and runs it. The agents themselves (what's
 * installed, their models and effort levels) are in agents.mjs.
 *
 *   claude    Claude Code CLI
 *   codex     Codex CLI
 *   gemini    Gemini CLI
 *   api       any OpenAI-compatible API, cloud or local (OpenAI, OpenRouter, vLLM…)
 *   ollama    a local Ollama server
 *   lmstudio  a local LM Studio server
 *   command   any CLI that takes a prompt and prints an answer
 *   none      no AI; the map, search, saved traces and trace codes still work
 *   auto      the first one that's available, in the order above (api and command when configured)
 *
 * Tasks: "trace" (traces and flowcharts) and "generate" (drawing and updating the map).
 */
import { checkApi } from './api.mjs';
import { listAgents, publicAgent, resolveSelection, runSelection } from './agents.mjs';

const SETUP_HINT = 'See SETUP.md to set one up. Without one you can still browse the map and open trace codes from teammates.';

/** The agent a task would use, and whether it can run. Never throws. */
async function detectProvider(config, task = 'trace') {
    try {
        const sel = await resolveSelection(config, { task });
        return {
            id: sel.agent.id,
            available: true,
            label: sel.label,
            detail: sel.agent.detail,
            auto: sel.auto,
            model: sel.model,
            effort: sel.effort,
            settings: sel.agent.kind === 'api' ? { ...sel.agent.settings, model: sel.model } : undefined,
        };
    } catch (err) {
        return { id: err.agentId || 'none', available: false, label: err.label || 'No AI tool', reason: err.message, tried: err.tried };
    }
}

/**
 * Start a run. `pick` ({ agent, model, effort }) overrides the task's defaults.
 * Throws (code "pick") when the pick isn't valid; otherwise returns
 * { promise, kill, label, used }, with a rejected promise when no agent can run.
 */
async function runAi({ root, config, prompt, onProgress, maxTurns, timeoutMs, task = 'trace', pick = {} }) {
    let sel;
    try {
        sel = await resolveSelection(config, { task, pick });
    } catch (err) {
        if (err.code === 'pick') {
            throw err;
        }
        const unavailable = Object.assign(new Error(`${err.message} ${SETUP_HINT}`), { code: 'unavailable' });
        return { promise: Promise.reject(unavailable), kill: () => {}, label: err.label || 'AI tool', used: null };
    }
    const run = runSelection(sel, { root, config, prompt, onProgress, maxTurns, timeoutMs: timeoutMs || config.ai.timeoutMs });
    return { ...run, label: sel.label, used: { agent: sel.agent.id, model: sel.model, effort: sel.effort, label: sel.label } };
}

/** Public-safe summary for the browser (no keys, no paths beyond the base URL). */
async function providerSummary(config) {
    const p = await detectProvider(config);
    return { id: p.id, available: p.available, label: p.label, reason: p.reason || '' };
}

/**
 * Every agent for the browser's pickers, the default selection for traces, and
 * what drawing the map uses (`generate`: resolved; `generateSet`: whether
 * ai.generate names its own tool, or it follows the trace default).
 */
async function agentsSummary(config, { refresh = false } = {}) {
    const agents = await listAgents(config, { refresh });
    const [p, g] = await Promise.all([detectProvider(config), detectProvider(config, 'generate')]);
    const pickOf = (x) => (x.available ? { agent: x.id, model: x.model || '', effort: x.effort || '' } : null);
    return {
        agents: agents.map(publicAgent),
        default: pickOf(p),
        generate: pickOf(g),
        generateSet: Boolean(config.ai.generate.provider),
        generateReason: g.available ? '' : g.reason || '',
        off: config.ai.provider === 'none',
    };
}

/** What a run cost, for people: "$0.42", "<$0.01", "12,345 tokens" or ''. */
function spendText(out) {
    if (out && out.cost) {
        return out.cost < 0.01 ? '<$0.01' : `$${out.cost.toFixed(2)}`;
    }
    return out && out.tokens ? `${out.tokens.toLocaleString()} tokens` : '';
}

export { SETUP_HINT, agentsSummary, checkApi, detectProvider, providerSummary, runAi, spendText };

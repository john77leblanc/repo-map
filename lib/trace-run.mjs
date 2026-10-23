import { effortsFor, resolveSelection, runSelection } from './ai/agents.mjs';
import { extractJson } from './json.mjs';
import { classifyPrompt, tracePrompt } from './prompts.mjs';

// Explicit aliases only, and only when the provider actually lists them.
const SMALL_MODELS = {
    claude: ['haiku'], gemini: ['gemini-2.5-flash-lite', 'gemini-2.5-flash'],
    codex: ['gpt-6-luna', 'gpt-5.1-codex-mini', 'gpt-5-codex-mini'],
    api: ['gpt-5-nano', 'gpt-4.1-nano', 'gpt-4o-mini'],
};

function classifierPick(selection, override = {}) {
    const { agent } = selection;
    const candidates = SMALL_MODELS[agent.id] || [];
    const model = override.model || candidates.find((id) => agent.models.some((m) => m.id === id)) || selection.model;
    const allowed = effortsFor(agent, model);
    return { agent: agent.id, model, effort: override.effort || (allowed.includes('low') ? 'low' : '') };
}

/** One cancellable lifecycle for hidden routing and the visible response. */
function runTrace({ root, config, map, question, flow, guidance, selection, onProgress,
    resolve = resolveSelection, run = runSelection }) {
    let active = null, stopped = false;
    const stoppedError = () => Object.assign(new Error('Stopped.'), { code: 'stopped' });
    const start = (selected, prompt, extra = {}) => {
        if (stopped) throw stoppedError();
        active = run(selected, { root, config, prompt, timeoutMs: config.ai.timeoutMs, onProgress, ...extra });
        if (stopped) active.kill();
        return active.promise;
    };
    const promise = (async () => {
        let intent = 'auto', classified = null;
        try {
            const pick = classifierPick(selection, config.ai.classify);
            const selected = await resolve({ ...config, ai: { ...config.ai, effort: '' } }, { pick });
            classified = await start(selected, classifyPrompt(question), { maxTurns: 1, timeoutMs: Math.min(config.ai.timeoutMs, 30000), onProgress: () => {} });
            const result = extractJson(classified.text);
            if (['description', 'proposal'].includes(result?.intent)) intent = result.intent;
        } catch {
            if (stopped) throw stoppedError();
            // Main agent performs routing when the lightweight request is unavailable.
        }
        if (stopped) throw stoppedError();
        const out = await start(selection, tracePrompt(config, map, question, { flow, guidance, intent }));
        if (stopped) throw stoppedError();
        const trace = extractJson(out.text);
        if (!trace) throw new Error(`${selection.label} answered, but not in the expected JSON shape. Try again, or try a stronger model.`);
        trace.intent = intent === 'auto' ? (trace.intent === 'proposal' ? 'proposal' : 'description') : intent;
        const total = (key) => [classified?.[key], out[key]].some((v) => typeof v === 'number')
            ? (classified?.[key] || 0) + (out[key] || 0) : null;
        return { trace, cost: total('cost'), turns: total('turns'), tokens: total('tokens'),
            label: selection.label, used: { agent: selection.agent.id, model: selection.model, effort: selection.effort, label: selection.label } };
    })();
    return { promise, kill: () => { stopped = true; active?.kill(); } };
}

export { classifierPick, runTrace };

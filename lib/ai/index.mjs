/**
 * Picks which AI tool runs traces and `generate`, and runs it.
 *
 *   claude   Claude Code CLI (default when it's installed)
 *   command  any CLI that takes a prompt and prints an answer (presets: codex, gemini)
 *   api      any OpenAI-compatible API, cloud or local (OpenAI, OpenRouter, Ollama, LM Studio…)
 *   none     no AI; the map, search, saved traces and trace codes still work
 *   auto     claude if installed, else api if a key or local server is configured, else command if set
 */
import { apiKey, apiLabel, checkApi, isLocal, runApi } from './api.mjs';
import { LABEL as CLAUDE_LABEL, runClaude } from './claude.mjs';
import { commandSettings, runCommand } from './command.mjs';
import { which } from './which.mjs';

const SETUP_HINT = 'See SETUP.md to set one up. Without one you can still browse the map and open trace codes from teammates.';

async function detectProvider(config) {
    const ai = config.ai;
    if (ai.invalidProvider) {
        return { id: 'none', available: false, label: 'No AI tool', reason: `Unknown ai.provider "${ai.invalidProvider}". Use auto, claude, command, api or none.` };
    }
    const claude = async () => {
        const found = await which(ai.claude.bin);
        return found
            ? { id: 'claude', available: true, label: CLAUDE_LABEL, detail: found }
            : { id: 'claude', available: false, label: CLAUDE_LABEL, reason: `Claude Code isn’t installed (\`${ai.claude.bin}\` not found on PATH).` };
    };
    const command = async () => {
        const s = commandSettings(ai.command);
        if (!s.bin) {
            return { id: 'command', available: false, label: 'AI command', reason: 'ai.command.bin (or ai.command.preset) isn’t set.' };
        }
        const found = await which(s.bin);
        return found
            ? { id: 'command', available: true, label: s.label, detail: found }
            : { id: 'command', available: false, label: s.label, reason: `${s.label} isn’t installed (\`${s.bin}\` not found on PATH).` };
    };
    const api = async () => {
        const label = apiLabel(ai.api);
        if (!ai.api.model) {
            return { id: 'api', available: false, label, reason: 'ai.api.model isn’t set.' };
        }
        if (!apiKey(ai.api) && !isLocal(ai.api)) {
            return { id: 'api', available: false, label, reason: `No API key in ${ai.api.apiKeyEnv}.` };
        }
        return { id: 'api', available: true, label, detail: ai.api.baseUrl };
    };

    switch (ai.provider) {
        case 'none':
            return { id: 'none', available: false, label: 'No AI tool', reason: 'AI is turned off (ai.provider is "none").' };
        case 'claude': return claude();
        case 'command': return command();
        case 'api': return api();
        default: {
            const tried = [];
            for (const probe of [claude, api, command]) {
                const r = await probe();
                if (r.available) {
                    return { ...r, auto: true };
                }
                tried.push(r.reason);
            }
            return { id: 'none', available: false, label: 'No AI tool', reason: `No AI tool found. ${tried[0]}`, tried };
        }
    }
}

/** Start a run with the detected provider. Returns { promise, kill, label }. */
async function runAi({ root, config, prompt, onProgress, maxTurns, timeoutMs }) {
    const provider = await detectProvider(config);
    if (!provider.available) {
        const err = Object.assign(new Error(`${provider.reason} ${SETUP_HINT}`), { code: 'unavailable' });
        return { promise: Promise.reject(err), kill: () => {}, label: provider.label };
    }
    const common = { root, config, prompt, onProgress, maxTurns, timeoutMs: timeoutMs || config.ai.timeoutMs };
    const run = provider.id === 'claude'
        ? runClaude({ ...common, settings: config.ai.claude })
        : provider.id === 'command'
            ? runCommand({ ...common, settings: config.ai.command })
            : runApi({ ...common, settings: config.ai.api });
    return { ...run, label: provider.label };
}

/** Public-safe summary for the browser (no keys, no paths beyond the base URL). */
async function providerSummary(config) {
    const p = await detectProvider(config);
    return { id: p.id, available: p.available, label: p.label, reason: p.reason || '' };
}

export { SETUP_HINT, checkApi, detectProvider, providerSummary, runAi };

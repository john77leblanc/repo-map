/**
 * Any OpenAI-compatible Chat Completions API (OpenAI, OpenRouter, Azure OpenAI,
 * Ollama, LM Studio, vLLM, …). The model gets read-only repo tools from
 * tools.mjs and this module runs the tool-call loop.
 */
import { classifyFailure } from './errors.mjs';
import { createRepoTools, describeToolCall } from './tools.mjs';

const LOCAL_HOST = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?(\/|$)/i;

function apiKey(settings, env = process.env) {
    return env[settings.apiKeyEnv] || (settings.apiKeyEnv === 'REPO_MAP_API_KEY' ? env.OPENAI_API_KEY : '') || '';
}

function isLocal(settings) {
    return LOCAL_HOST.test(settings.baseUrl || '');
}

function apiLabel(settings) {
    const host = (() => {
        try {
            return new URL(settings.baseUrl).host;
        } catch {
            return settings.baseUrl;
        }
    })();
    return `${settings.model || 'model'} via ${host}`;
}

function headers(settings) {
    const key = apiKey(settings);
    return { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) };
}

async function postJson(settings, body, signal) {
    const url = `${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    let res;
    try {
        res = await fetch(url, { method: 'POST', headers: headers(settings), body: JSON.stringify(body), signal });
    } catch (err) {
        if (err.name === 'AbortError') {
            throw err;
        }
        throw Object.assign(new Error(`Couldn't reach ${url} (${err.cause?.code || err.message}). Is the server running and the base URL right?`), { code: 'unreachable' });
    }
    const text = await res.text();
    if (!res.ok) {
        const f = classifyFailure(apiLabel(settings), `HTTP ${res.status} ${text.slice(0, 600)}`, `Set ${settings.apiKeyEnv} (see SETUP.md).`);
        throw Object.assign(new Error(f.message), { code: f.code, status: res.status });
    }
    try {
        return JSON.parse(text);
    } catch {
        throw Object.assign(new Error(`${apiLabel(settings)} returned something that isn't JSON.`), { code: 'failed' });
    }
}

function runApi({ root, config, prompt, settings, timeoutMs, maxTurns, onProgress = () => {} }) {
    const ctl = new AbortController();
    const tools = createRepoTools(root, config);
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    const toolDefs = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
    const limit = maxTurns || settings.maxTurns || 30;
    const label = apiLabel(settings);

    const promise = (async () => {
        if (!settings.model) {
            throw Object.assign(new Error('No model is set for the API provider. Set ai.api.model (or REPO_MAP_MODEL); see SETUP.md.'), { code: 'config' });
        }
        if (!apiKey(settings) && !isLocal(settings)) {
            throw Object.assign(new Error(`No API key found in ${settings.apiKeyEnv}. Set it (see SETUP.md), or point ai.api.baseUrl at a local server.`), { code: 'auth' });
        }
        const timer = setTimeout(() => ctl.abort(new Error('timeout')), timeoutMs);
        const messages = [
            { role: 'system', content: 'You explore a code repository with the provided read-only tools, then answer exactly in the format the user asks for.' },
            { role: 'user', content: prompt },
        ];
        let usage = 0;
        try {
            onProgress(`Asking ${label}…`);
            for (let turn = 1; turn <= limit; turn++) {
                const lastTurn = turn === limit;
                const data = await postJson(settings, {
                    model: settings.model,
                    messages,
                    ...(lastTurn ? {} : { tools: toolDefs, tool_choice: 'auto' }),
                }, ctl.signal);
                usage += data.usage?.total_tokens || 0;
                const msg = data.choices?.[0]?.message;
                if (!msg) {
                    throw Object.assign(new Error(`${label} returned no message.`), { code: 'failed' });
                }
                const calls = msg.tool_calls || [];
                if (!calls.length) {
                    if (!msg.content) {
                        throw Object.assign(new Error(`${label} returned an empty answer.`), { code: 'failed' });
                    }
                    return { text: msg.content, cost: null, turns: turn, tokens: usage || null };
                }
                messages.push({ role: 'assistant', content: msg.content || null, tool_calls: calls });
                for (const call of calls) {
                    let args = {};
                    try {
                        args = JSON.parse(call.function?.arguments || '{}');
                    } catch {
                        // leave empty; the tool reports what's missing
                    }
                    const tool = byName[call.function?.name];
                    let content;
                    if (!tool) {
                        content = `Error: unknown tool ${call.function?.name}`;
                    } else {
                        onProgress(describeToolCall(tool.name, args));
                        try {
                            content = String(await tool.run(args)).slice(0, 30000);
                        } catch (err) {
                            content = `Error: ${err.message}`;
                        }
                    }
                    messages.push({ role: 'tool', tool_call_id: call.id, content });
                }
                if (turn === limit - 1) {
                    messages.push({ role: 'user', content: 'You are out of tool calls. Reply now with the final JSON only.' });
                }
            }
            throw Object.assign(new Error(`${label} ran out of turns before answering. Try a narrower question.`), { code: 'turns' });
        } catch (err) {
            if (err.name === 'AbortError' || ctl.signal.aborted) {
                const timedOut = ctl.signal.reason?.message === 'timeout';
                throw Object.assign(new Error(timedOut ? `${label} took too long and was stopped.` : 'Stopped.'), { code: timedOut ? 'timeout' : 'stopped' });
            }
            throw err;
        } finally {
            clearTimeout(timer);
        }
    })();
    return { promise, kill: () => ctl.abort() };
}

/** Cheap reachability check for `repo-map doctor`: GET /models (no tokens spent). */
async function checkApi(settings) {
    const url = `${settings.baseUrl.replace(/\/+$/, '')}/models`;
    try {
        const res = await fetch(url, { headers: headers(settings), signal: AbortSignal.timeout(8000) });
        if (res.ok) {
            const data = await res.json().catch(() => ({}));
            const ids = (data.data || data.models || []).map((m) => m.id || m.name).filter(Boolean);
            const hasModel = !settings.model || !ids.length || ids.includes(settings.model);
            return { ok: hasModel, detail: hasModel ? `reachable${ids.length ? `, ${ids.length} models` : ''}` : `reachable, but model "${settings.model}" isn't listed` };
        }
        const f = classifyFailure(apiLabel(settings), `HTTP ${res.status} ${(await res.text()).slice(0, 300)}`, `Set ${settings.apiKeyEnv}.`);
        return { ok: false, detail: f.message };
    } catch (err) {
        return { ok: false, detail: `couldn't reach ${url} (${err.cause?.code || err.message})` };
    }
}

export { apiKey, apiLabel, checkApi, isLocal, runApi };

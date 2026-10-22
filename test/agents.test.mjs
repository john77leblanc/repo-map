import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { listAgents, parseClaudeHelp, resolveSelection } from '../lib/ai/agents.mjs';
import { runApi } from '../lib/ai/api.mjs';
import { commandArgs, commandSettings, runCommand } from '../lib/ai/command.mjs';
import { detectProvider } from '../lib/ai/index.mjs';
import { resolveAi, withDefaults } from '../lib/config.mjs';

const EXAMPLE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'shop');
const NOT_INSTALLED = 'definitely-not-installed-xyz';

/** Run `fn` with a CODEX_HOME holding a models cache like the one Codex writes. */
async function withCodexHome(models, fn) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'repo-map-codex-'));
    writeFileSync(path.join(dir, 'models_cache.json'), JSON.stringify({ models }));
    const saved = process.env.CODEX_HOME;
    process.env.CODEX_HOME = dir;
    try {
        return await fn();
    } finally {
        if (saved === undefined) {
            delete process.env.CODEX_HOME;
        } else {
            process.env.CODEX_HOME = saved;
        }
    }
}

// A config where only a "codex" we control is installed (node itself stands in for the binary)
const codexOnly = (ai = {}) => withDefaults({}, { localAi: { claude: { bin: NOT_INSTALLED }, codex: { bin: process.execPath }, gemini: { bin: NOT_INSTALLED }, ...ai } });
const CODEX_MODELS = [
    { slug: 'big', display_name: 'Big', visibility: 'list', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }, { effort: 'max' }] },
    { slug: 'small', visibility: 'list', supported_reasoning_levels: [{ effort: 'low' }] },
    { slug: 'secret', visibility: 'hide', supported_reasoning_levels: [] },
];

test('codex and gemini get model and effort flags where their presets put them', () => {
    const codex = commandSettings({ preset: 'codex', model: 'big', effort: 'high' });
    assert.deepEqual(commandArgs(codex, 'p'), ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '-m', 'big', '-c', 'model_reasoning_effort=high', '-']);
    assert.deepEqual(commandArgs(commandSettings({ preset: 'codex' }), 'p'), ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '-']);
    assert.deepEqual(commandArgs(commandSettings({ preset: 'gemini', model: 'gemini-2.5-pro' }), 'the prompt'), ['-m', 'gemini-2.5-pro', '-p', 'the prompt']);
    // custom args without {options}: flags go at the end
    assert.deepEqual(commandArgs(commandSettings({ bin: 'x', args: ['run'], modelArgs: ['--model={model}'], model: 'm' }), 'p'), ['run', '--model=m']);
});

test('a command run passes the chosen model as flags (and env) to the CLI', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'repo-map-argv-'));
    const script = path.join(dir, 'echo-argv.mjs');
    writeFileSync(script, 'process.stdin.resume();process.stdin.on("end",()=>console.log(JSON.stringify({argv:process.argv.slice(2),model:process.env.REPO_MAP_MODEL,effort:process.env.REPO_MAP_EFFORT})));\n');
    const run = runCommand({
        root: EXAMPLE,
        prompt: 'hi',
        settings: { bin: process.execPath, args: [script, '{options}'], modelArgs: ['-m', '{model}'], effortArgs: ['--effort', '{effort}'], model: 'big', effort: 'high' },
        timeoutMs: 10000,
    });
    assert.deepEqual(JSON.parse((await run.promise).text), { argv: ['-m', 'big', '--effort', 'high'], model: 'big', effort: 'high' });
});

test('Claude Code’s --help gives its model aliases and effort levels', () => {
    const help = `  --effort <level>                      Effort level for the current session
                                        (low, medium, high, xhigh, max)
  --model <model>                       Model for the current session. Provide
                                        an alias for the latest model (e.g.
                                        'fable', 'opus', or 'sonnet') or a
                                        model's full name.`;
    assert.deepEqual(parseClaudeHelp(help), { efforts: ['low', 'medium', 'high', 'xhigh', 'max'], models: ['fable', 'opus', 'sonnet'] });
    assert.deepEqual(parseClaudeHelp(''), { efforts: [], models: [] });
});

test('Codex models and their effort levels come from its local cache', async () => {
    await withCodexHome(CODEX_MODELS, async () => {
        const agents = await listAgents(codexOnly(), { refresh: true });
        const codex = agents.find((a) => a.id === 'codex');
        assert.equal(codex.available, true);
        assert.deepEqual(codex.models.map((m) => m.id), ['big', 'small'], 'hidden models are left out');
        assert.deepEqual(codex.models[0].efforts, ['low', 'high', 'max']);
        assert.equal(agents.find((a) => a.id === 'gemini').available, false);
    });
});

test('picks are checked against what the agent offers', async () => {
    await withCodexHome(CODEX_MODELS, async () => {
        const cfg = codexOnly({ provider: 'codex' });
        const sel = await resolveSelection(cfg, { pick: { model: 'big', effort: 'max' } });
        assert.equal(sel.agent.id, 'codex');
        assert.equal(sel.label, 'Codex CLI · big · max');
        const reject = (pick) => assert.rejects(resolveSelection(cfg, { pick }), (err) => err.code === 'pick');
        await reject({ model: 'small', effort: 'max' }); // max is only offered by "big"
        await reject({ model: '--yolo' });
        await reject({ model: 'a b' });
        await reject({ agent: 'gemini' }); // not installed
        await reject({ agent: 'nonsense' });
        // a typed model the cache doesn't know is fine, with the agent's general levels
        assert.equal((await resolveSelection(cfg, { pick: { model: 'brand-new', effort: 'medium' } })).effort, 'medium');
    });
});

test('drawing the map uses ai.generate; a saved effort the tool lacks is dropped, not fatal', async () => {
    await withCodexHome(CODEX_MODELS, async () => {
        const cfg = codexOnly({ provider: 'codex', effort: 'max', codex: { bin: process.execPath, model: 'small' }, generate: { model: 'big', effort: 'high' } });
        const trace = await resolveSelection(cfg);
        assert.deepEqual([trace.model, trace.effort], ['small', ''], '"small" has no "max"');
        const map = await resolveSelection(cfg, { task: 'generate' });
        assert.deepEqual([map.agent.id, map.model, map.effort], ['codex', 'big', 'high']);
        const p = await detectProvider(cfg, 'generate');
        assert.equal(p.label, 'Codex CLI · big · high');
    });
});

test('settings saved before 0.5 ("command" with a codex preset) still pick Codex', async () => {
    await withCodexHome([], async () => {
        const cfg = withDefaults({}, { localAi: { claude: { bin: NOT_INSTALLED }, provider: 'command', command: { preset: 'codex', bin: process.execPath, model: 'old' } } });
        const sel = await resolveSelection(cfg);
        assert.equal(sel.agent.id, 'codex');
        assert.equal(sel.model, 'old');
    });
});

test('flags and env apply to every task: they replace a saved map choice', () => {
    const saved = { provider: 'claude', generate: { provider: 'codex', model: 'big', effort: 'high' } };
    assert.deepEqual(resolveAi({ globalAi: saved, env: {} }).generate, saved.generate);
    const viaProvider = resolveAi({ globalAi: saved, env: { REPO_MAP_AI_PROVIDER: 'gemini', REPO_MAP_EFFORT: 'low' } });
    assert.equal(viaProvider.provider, 'gemini');
    assert.equal(viaProvider.effort, 'low');
    assert.deepEqual(viaProvider.generate, { provider: '', model: '', effort: '' });
    const viaModel = resolveAi({ globalAi: saved, env: { REPO_MAP_MODEL: 'm' } });
    assert.deepEqual(viaModel.generate, { provider: 'codex', model: '', effort: 'high' });
    assert.equal(viaModel.codex.model, 'm');
    assert.equal(resolveAi({ globalAi: { generate: { provider: 'bogus' } }, env: {} }).generate.provider, '');
});

test('api runner sends the chosen effort as reasoning_effort, and only when chosen', async () => {
    const bodies = [];
    const server = createServer((req, res) => {
        let b = '';
        req.on('data', (d) => {
            b += d;
        });
        req.on('end', () => {
            bodies.push(JSON.parse(b));
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '{}' } }] }));
        });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
        const cfg = withDefaults({}, {});
        const settings = { ...cfg.ai.api, baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'm' };
        await runApi({ root: EXAMPLE, config: cfg, prompt: 'x', settings: { ...settings, effort: 'high' }, timeoutMs: 5000 }).promise;
        await runApi({ root: EXAMPLE, config: cfg, prompt: 'x', settings, timeoutMs: 5000 }).promise;
        assert.equal(bodies[0].reasoning_effort, 'high');
        assert.equal('reasoning_effort' in bodies[1], false);
    } finally {
        server.close();
    }
});

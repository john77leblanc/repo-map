import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runApi } from '../lib/ai/api.mjs';
import { runCommand } from '../lib/ai/command.mjs';
import { classifyFailure } from '../lib/ai/errors.mjs';
import { detectProvider } from '../lib/ai/index.mjs';
import { createRepoTools } from '../lib/ai/tools.mjs';
import { resolveAi, withDefaults } from '../lib/config.mjs';

const EXAMPLE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'shop');
const NO_ENV = { PATH: '' };

test('AI settings layer: defaults < repo < global < local < env', () => {
    const ai = resolveAi({
        repoAi: { provider: 'claude', api: { model: 'repo-model' } },
        globalAi: { api: { baseUrl: 'http://localhost:11434/v1' } },
        localAi: { provider: 'api' },
        env: { REPO_MAP_MODEL: 'env-model' },
    });
    assert.equal(ai.provider, 'api');
    assert.equal(ai.api.baseUrl, 'http://localhost:11434/v1');
    assert.equal(ai.api.model, 'env-model');
    assert.equal(ai.api.apiKeyEnv, 'REPO_MAP_API_KEY');
});

test('0.1.x "claude" config blocks still work', () => {
    const cfg = withDefaults({ claude: { bin: '/opt/claude', model: 'opus', maxTurns: 12 } }, {});
    assert.equal(cfg.ai.claude.bin, '/opt/claude');
    assert.equal(cfg.ai.claude.maxTurns, 12);
    assert.equal(cfg.claude, undefined);
});

test('auto picks no provider when nothing is installed or configured', async () => {
    const saved = process.env.PATH;
    const savedKeys = [process.env.REPO_MAP_API_KEY, process.env.OPENAI_API_KEY];
    process.env.PATH = '';
    delete process.env.REPO_MAP_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
        const p = await detectProvider(withDefaults({}, {}));
        assert.equal(p.available, false);
        assert.match(p.reason, /No AI tool found/);
    } finally {
        process.env.PATH = saved;
        [process.env.REPO_MAP_API_KEY, process.env.OPENAI_API_KEY] = savedKeys.map((v) => v ?? '');
    }
});

test('auto falls back to a local OpenAI-compatible server without a key', async () => {
    const saved = process.env.PATH;
    process.env.PATH = '';
    try {
        const cfg = withDefaults({}, { localAi: { api: { baseUrl: 'http://localhost:11434/v1', model: 'qwen' } } });
        const p = await detectProvider(cfg);
        assert.equal(p.id, 'api');
        assert.equal(p.available, true);
    } finally {
        process.env.PATH = saved;
    }
});

test('failures are explained in plain words', () => {
    assert.equal(classifyFailure('X', 'Error: Invalid API key provided').code, 'auth');
    assert.equal(classifyFailure('X', 'HTTP 429 rate limit reached').code, 'limit');
    assert.equal(classifyFailure('X', 'model "foo" not found').code, 'model');
    assert.equal(classifyFailure('X', 'HTTP 403 Forbidden').code, 'access');
    const other = classifyFailure('X', 'segfault');
    assert.equal(other.code, 'failed');
    assert.match(other.message, /repo-map doctor/);
});

test('repo tools only read inside codeRoots', async () => {
    const cfg = withDefaults({ codeRoots: ['src/'] }, {});
    const tools = Object.fromEntries(createRepoTools(EXAMPLE, cfg).map((t) => [t.name, t]));
    const listing = await tools.list_files.run({});
    assert.match(listing, /src\/api\/orders\.js/);
    assert.doesNotMatch(listing, /\.repo-map/);
    assert.match(await tools.search_code.run({ query: 'chargeCard' }), /src\/api\/payments\.js:3:/);
    assert.match(await tools.read_file.run({ path: 'src/api/orders.js', start: 1, end: 1 }), /^src\/api\/orders\.js \(\d+ lines\)\n1\| import/);
    await assert.rejects(tools.read_file.run({ path: '.repo-map/config.json' }), /Not readable/);
    await assert.rejects(tools.read_file.run({ path: 'src/../../../etc/passwd' }), /Not readable/);
});

test('api provider runs the tool loop against an OpenAI-compatible server', async () => {
    const requests = [];
    const server = createServer((req, res) => {
        let body = '';
        req.on('data', (d) => {
            body += d;
        });
        req.on('end', () => {
            const json = JSON.parse(body);
            requests.push(json);
            const sawTool = json.messages.some((m) => m.role === 'tool');
            const message = sawTool
                ? { role: 'assistant', content: '{"title":"Order flow","steps":[]}' }
                : { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search_code', arguments: '{"query":"placeOrder"}' } }] };
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ choices: [{ message }], usage: { total_tokens: 42 } }));
        });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address();
    try {
        const cfg = withDefaults({ codeRoots: ['src/'] }, {});
        const progress = [];
        const run = runApi({
            root: EXAMPLE,
            config: cfg,
            prompt: 'trace',
            settings: { ...cfg.ai.api, baseUrl: `http://127.0.0.1:${port}/v1`, model: 'test-model' },
            timeoutMs: 10000,
            onProgress: (t) => progress.push(t),
        });
        const out = await run.promise;
        assert.equal(out.text, '{"title":"Order flow","steps":[]}');
        assert.equal(out.tokens, 84);
        assert.equal(requests.length, 2);
        assert.equal(requests[0].model, 'test-model');
        assert.ok(progress.includes('Searching for “placeOrder”'));
        const toolMsg = requests[1].messages.find((m) => m.role === 'tool');
        assert.match(toolMsg.content, /src\/pages\/checkout\/CheckoutPage\.jsx/);
    } finally {
        server.close();
    }
});

test('api provider explains a rejected key', async () => {
    const server = createServer((req, res) => {
        res.statusCode = 401;
        res.end('{"error":{"message":"Incorrect API key provided"}}');
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
        const cfg = withDefaults({}, {});
        const run = runApi({ root: EXAMPLE, config: cfg, prompt: 'x', settings: { ...cfg.ai.api, baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'm' }, timeoutMs: 5000 });
        await assert.rejects(run.promise, (err) => err.code === 'auth');
    } finally {
        server.close();
    }
});

test('command provider pipes the prompt to any CLI and reads its answer', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'repo-map-cmd-'));
    // node runs the fake CLIs, so this works the same on every OS
    const script = path.join(dir, 'fake-ai.mjs');
    writeFileSync(script, 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.error("thinking");console.log(JSON.stringify({echo:s.trim(),arg:process.argv[2]||""}));});\n');
    const run = runCommand({ root: EXAMPLE, prompt: 'hello', settings: { bin: process.execPath, args: [script, '--flag'], label: 'Fake AI' }, timeoutMs: 10000 });
    const out = await run.promise;
    assert.deepEqual(JSON.parse(out.text), { echo: 'hello', arg: '--flag' });

    const fail = path.join(dir, 'fake-fail.mjs');
    writeFileSync(fail, 'console.error("Error: not logged in. Please run fake login");process.exit(1);\n');
    await assert.rejects(runCommand({ root: EXAMPLE, prompt: 'x', settings: { bin: process.execPath, args: [fail], label: 'Fake AI', authHint: 'Run `fake login`.' }, timeoutMs: 10000 }).promise,
        (err) => err.code === 'auth' && /Run `fake login`/.test(err.message));
});

test('missing command is reported clearly', async () => {
    const run = runCommand({ root: EXAMPLE, prompt: 'x', settings: { bin: 'definitely-not-installed-xyz', label: 'Nope' }, timeoutMs: 5000 });
    await assert.rejects(run.promise, (err) => err.code === 'missing');
    assert.ok(NO_ENV);
});

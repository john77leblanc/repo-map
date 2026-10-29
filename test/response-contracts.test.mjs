import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runClaude } from '../lib/ai/claude.mjs';
import { runAi } from '../lib/ai/index.mjs';
import { withDefaults } from '../lib/config.mjs';
import { generateMap } from '../lib/generate.mjs';
import { RESPONSE_SCHEMAS, parseResponse, responsePrompt, schemaErrors, traceSchema } from '../lib/response-contracts.mjs';

const trace = { intent: 'description', title: 'Checkout', summary: 'Place an order', steps: [
    { id: 'checkout', note: 'Submit order', refs: [{ path: 'src/order.mjs', start: 1, end: 5 }] },
], edges: [['checkout', 'orders']], gaps: '' };
const flow = { nodes: [{ id: 'start', type: 'start', label: 'Begin' }, { id: 'end', type: 'end', label: 'Finish' }],
    edges: [{ from: 'start', to: 'end' }] };
const sitemapTrace = { applicability: 'none', summary: 'No screens apply', steps: [], navigation: [], gaps: [], changes: { screens: [], navigation: [] } };
const fixtures = {
    classify: { intent: 'description', title: 'Checkout' }, flow: { flow },
    expand: { summary: 'Charges the card', gaps: '', nodes: [{ id: 'x1', type: 'process', label: 'Build request', refs: [{ path: 'src/pay.mjs', start: 1, end: 5 }] },
        { id: 'x2', type: 'decision', label: 'Approved?' }], edges: [{ from: 'x1', to: 'x2' }], entry: 'x1', exits: [{ arrow: 1, from: 'x2' }] },
    plan: { summary: 'Implementation', tasks: [{ title: 'Update checkout', detail: 'Validate orders', files: [] }], interfaces: [], tests: [], risks: [], questions: [] },
    generate: { groups: [{ id: 'shop', col: 0, title: 'Shop' }], nodes: [{ id: 'checkout', group: 'shop', kind: 'service', path: 'src/', desc: 'Checkout' }], edges: [] },
    update: { summary: 'No changes' }, docs: { links: [{ node: 'checkout', path: 'README.md', start: 1, end: 4, title: 'Checkout', why: 'Overview', kind: 'doc' }] },
    sitemap: { version: 1, applicability: 'none', summary: 'Backend only', applications: [], screens: [], navigation: [], gaps: [] },
    sitemapTrace: { sitemap: sitemapTrace },
    components: { version: 1, applicability: 'applicable', summary: 'Pages.', gaps: [],
        components: [{ id: 'page', label: 'Page', detail: '', tags: ['state'], card: '', refs: [{ path: 'src/a.jsx', start: 1, end: 9 }] }],
        uses: [], screens: [{ screen: 'home', root: 'page' }] },
    seams: { seams: [{ from: 'checkout', to: 'api:orders', type: 'http', label: 'POST /orders', why: 'Posts the order', refs: [{ path: 'src/order.mjs', start: 1, end: 5 }] }] },
};

for (const [name, schema] of Object.entries(RESPONSE_SCHEMAS)) {
    test(`${name} contract accepts its wire format and rejects missing fields, unknown fields and non-objects`, () => {
        assert.deepEqual(parseResponse(JSON.stringify(fixtures[name]), schema), fixtures[name]);
        for (const value of [null, [], true, 'text', {}, { ...fixtures[name], unexpected: true }]) {
            assert.throws(() => parseResponse(JSON.stringify(value), schema), { code: 'schema' });
        }
    });
}

test('trace contracts require requested outputs, proposal data, exact pairs and nested types', () => {
    const schema = traceSchema();
    assert.deepEqual(parseResponse(JSON.stringify(trace), schema), trace);
    for (const invalid of [
        { ...trace, steps: 'wrong' }, { ...trace, steps: [{ ...trace.steps[0], refs: [{ path: 'src/a', start: '1', end: 4 }] }] },
        { ...trace, edges: [['checkout']] }, { ...trace, intent: 'proposal' },
    ]) assert.throws(() => parseResponse(JSON.stringify(invalid), schema), { code: 'schema' });
    assert.throws(() => parseResponse(JSON.stringify(trace), traceSchema({ flow: true })), /\$\.flow: required/);
    assert.throws(() => parseResponse(JSON.stringify(trace), traceSchema({ sitemap: {} })), /\$\.sitemap: required/);
    assert.throws(() => parseResponse(JSON.stringify(trace), traceSchema({ intent: 'proposal' })), /invalid JSON response/);
    assert.equal(schemaErrors({ ...trace, flow, sitemap: sitemapTrace }, traceSchema({ flow: true, sitemap: {} })).length, 0);
    assert.equal(schemaErrors({ ...trace, intent: 'proposal', proposal: { nodes: [], edges: [] } }, schema).length, 0);
});

test('all contract keywords are covered by the dependency-free validator', () => {
    const allowed = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'minItems', 'maxItems', 'minimum', 'enum', 'anyOf']);
    function check(schema) {
        for (const key of Object.keys(schema)) assert.ok(allowed.has(key), `Unsupported validator keyword: ${key}`);
        for (const value of Object.values(schema.properties || {})) check(value);
        if (schema.items) check(schema.items);
        for (const value of schema.anyOf || []) check(value);
    }
    for (const schema of [...Object.values(RESPONSE_SCHEMAS), traceSchema({ flow: true, sitemap: {} })]) check(schema);
});

test('Claude receives the schema and reads structured_output rather than the prose result', async () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
    let args;
    const schema = RESPONSE_SCHEMAS.classify;
    const runner = runClaude({ root: '.', prompt: 'Classify checkout', responseSchema: schema, settings: {}, timeoutMs: 1000,
        spawnProcess: (_, argv) => { args = argv; return child; } });
    assert.deepEqual(JSON.parse(args[args.indexOf('--json-schema') + 1]), schema);
    assert.ok(args.includes('--allowedTools'));
    const result = JSON.stringify({ type: 'result', subtype: 'success', result: 'Here are the findings',
        structured_output: fixtures.classify, total_cost_usd: 0.02, num_turns: 2 });
    child.stdout.write(result.slice(0, 20));
    child.stdout.write(result.slice(20));
    child.emit('close', 0); // A final stream event need not end in a newline.
    const out = await runner.promise;
    assert.deepEqual(JSON.parse(out.text), fixtures.classify);
    assert.equal(out.cost, 0.02);
    assert.equal(out.turns, 2);
});

function fakeClaude() {
    const calls = [];
    const spawnProcess = (_, args) => {
        const child = new EventEmitter();
        child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
        child.kill = () => { child.killed = true; child.emit('close', 1); };
        calls.push({ args, child });
        return child;
    };
    const fail = (message, index = 0) => calls[index].child.stdout.write(JSON.stringify({
        type: 'result', subtype: 'error_during_execution', is_error: true, errors: [message],
    }) + '\n');
    return { calls, spawnProcess, fail };
}

const rejection = 'API Error: 400 tools.7.custom.input_schema: input_schema does not support oneOf, allOf, or anyOf at the top level';

test('Claude uses a simple native schema and falls back on the same model with the full prompt contract', async () => {
    const fake = fakeClaude();
    const schema = traceSchema();
    const runner = runClaude({ root: '.', prompt: 'Trace checkout', responseSchema: schema,
        settings: { model: 'custom-model', effort: 'low' }, timeoutMs: 1000, spawnProcess: fake.spawnProcess });
    const args = fake.calls[0].args;
    const wire = JSON.parse(args[args.indexOf('--json-schema') + 1]);
    assert.equal(wire.anyOf, undefined);
    assert.ok(schema.anyOf);
    assert.equal(args[args.indexOf('--tools') + 1], 'Read,Grep,Glob');
    assert.ok(args.includes('--strict-mcp-config'));
    fake.fail(rejection);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(fake.calls.length, 2);
    const retry = fake.calls[1];
    assert.deepEqual(retry.args, args.slice(0, -2));
    assert.match(retry.child.stdin.read().toString(), /anyOf/);
    retry.child.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', result: JSON.stringify(trace) }) + '\n');
    assert.deepEqual(parseResponse((await runner.promise).text, schema), trace);
});

test('Claude schema compatibility retry is bounded', async () => {
    const fake = fakeClaude();
    const runner = runClaude({ root: '.', prompt: '', responseSchema: traceSchema(), settings: {}, timeoutMs: 1000, spawnProcess: fake.spawnProcess });
    fake.fail(rejection);
    await new Promise(resolve => setImmediate(resolve));
    fake.fail(rejection, 1);
    await assert.rejects(runner.promise);
    assert.equal(fake.calls.length, 2);
});

for (const message of ['API Error: 401 unauthorized', 'API Error: 429 rate limit', 'connection refused', 'unknown option --tools']) {
    test(`Claude does not retry unrelated failure: ${message}`, async () => {
        const fake = fakeClaude();
        const runner = runClaude({ root: '.', prompt: '', responseSchema: traceSchema(), settings: {}, timeoutMs: 1000, spawnProcess: fake.spawnProcess });
        fake.fail(message);
        await assert.rejects(runner.promise);
        assert.equal(fake.calls.length, 1);
    });
}

test('cancelling Claude before fallback prevents another process', async () => {
    const fake = fakeClaude();
    const runner = runClaude({ root: '.', prompt: '', responseSchema: traceSchema(), settings: {}, timeoutMs: 1000, spawnProcess: fake.spawnProcess });
    fake.fail(rejection);
    runner.kill();
    await assert.rejects(runner.promise);
    assert.equal(fake.calls.length, 1);
});

test('Claude fallback remains cancellable', async () => {
    const fake = fakeClaude();
    const runner = runClaude({ root: '.', prompt: '', responseSchema: traceSchema(), settings: {}, timeoutMs: 1000, spawnProcess: fake.spawnProcess });
    fake.fail("error: unknown option '--json-schema'");
    await new Promise(resolve => setImmediate(resolve));
    runner.kill();
    await assert.rejects(runner.promise);
    assert.equal(fake.calls.length, 2);
    assert.equal(fake.calls[1].child.killed, true);
});

test('Claude does not start fallback after the original deadline', async t => {
    let now = 0;
    t.mock.method(Date, 'now', () => now);
    const fake = fakeClaude();
    const runner = runClaude({ root: '.', prompt: '', responseSchema: traceSchema(), settings: {}, timeoutMs: 1000, spawnProcess: fake.spawnProcess });
    now = 1001;
    fake.fail(rejection);
    await assert.rejects(runner.promise, { code: 'timeout' });
    assert.equal(fake.calls.length, 1);
});

test('Claude fallback uses only the remaining timeout', async t => {
    let now = 0;
    t.mock.method(Date, 'now', () => now);
    const delays = [];
    const schedule = globalThis.setTimeout;
    t.mock.method(globalThis, 'setTimeout', (callback, delay) => {
        delays.push(delay);
        return schedule(callback, delay);
    });
    const fake = fakeClaude();
    const runner = runClaude({ root: '.', prompt: '', responseSchema: traceSchema(), settings: {}, timeoutMs: 1000, spawnProcess: fake.spawnProcess });
    now = 750;
    fake.fail(rejection);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(delays, [1000, 250]);
    runner.kill();
    await assert.rejects(runner.promise);
});

test('API response boundary supplies the contract and rejects malformed output before callers consume it', async t => {
    let answer = fixtures.plan, prompt;
    const server = createServer((req, res) => {
        if (req.method === 'GET') return res.end(JSON.stringify({ data: [{ id: 'contract-test' }] }));
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            prompt = JSON.parse(body).messages.at(-1).content;
            res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }));
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    const config = withDefaults({}, { env: {}, localAi: { provider: 'api', api: {
        baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'contract-test',
    } } });
    const options = { root: '.', config, prompt: 'Create a plan', responseSchema: RESPONSE_SCHEMAS.plan };
    const first = await runAi(options);
    assert.deepEqual((await first.promise).value, fixtures.plan);
    assert.equal(prompt, responsePrompt(options.prompt, options.responseSchema));
    answer = { ...fixtures.plan, tasks: [{ title: 'Missing detail' }] };
    const second = await runAi(options);
    await assert.rejects(second.promise, error => error.code === 'schema' && error.issues.includes('$.tasks[0].detail: required'));
    const root = mkdtempSync(path.join(os.tmpdir(), 'repo-map-contract-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(path.join(root, '.repo-map'));
    const original = JSON.stringify(fixtures.generate);
    writeFileSync(path.join(root, '.repo-map/map.json'), original);
    answer = { nodes: [] };
    await assert.rejects(generateMap({ root, config, force: true, docs: false }), error => error.code === 'schema' && /map.raw.txt/.test(error.message));
    assert.equal(readFileSync(path.join(root, '.repo-map/map.json'), 'utf8'), original);
    assert.deepEqual(JSON.parse(readFileSync(path.join(root, '.repo-map/map.raw.txt'), 'utf8')), answer);
});

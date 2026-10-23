import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { layoutFlow, renderFlowSvg } from '../app/flowchart.mjs';
import { withDefaults } from '../lib/config.mjs';
import { flowToMermaid, normalizeFlow } from '../lib/flow.mjs';
import { classifyPrompt, flowPrompt, planPrompt, tracePrompt } from '../lib/prompts.mjs';
import { normalizePlan, normalizeProposal, proposalMap } from '../lib/proposal.mjs';
import { startServer } from '../lib/server.mjs';
import { classifierPick, runTrace } from '../lib/trace-run.mjs';

const map = { groups: [{ id: 'shop', title: 'Shop', col: 0 }], nodes: [
    { id: 'checkout', title: 'Checkout', group: 'shop', kind: 'service', path: 'src/' },
    { id: 'orders', title: 'Orders', group: 'shop', kind: 'service' },
], edges: [{ from: 'checkout', to: 'orders', type: 'http', label: 'Submit' }] };
const rawProposal = { rationale: 'Validate coupons before submitting the order.', assumptions: ['Coupons apply before tax.'], questions: ['Who manages codes?'], nodes: [
    { id: 'checkout', status: 'modified', rationale: 'Accept a coupon code.' },
    { id: 'proposal:coupons', status: 'new', title: 'Coupons', group: 'shop', kind: 'service', rationale: 'Validate the discount.', suggestedPath: 'src/coupons.mjs' },
], edges: [{ from: 'checkout', to: 'proposal:coupons', status: 'new', label: 'Check coupon' }, { from: 'checkout', to: 'orders', status: 'modified', label: 'Submit discounted order' }] };
const plan = { summary: 'Add coupon validation.', tasks: [{ title: 'Validate coupons', detail: 'Add validation and call it before order submission.', files: ['new: src/coupons.mjs'] }], tests: ['Reject expired coupons.'] };
const flow = { nodes: [{ id: 's', type: 'start', label: 'Begin' }, { id: 'c', label: 'Validate coupon', status: 'new', step: 2 }, { id: 'end', label: 'Submit order', status: 'modified' }], edges: [{ from: 's', to: 'c', status: 'new' }, { from: 'c', to: 'end', status: 'modified' }] };
const config = withDefaults({}, { env: {} });

test('proposal validation constrains identities, placement, statuses and connections', () => {
    const result = normalizeProposal({ ...rawProposal, nodes: [...rawProposal.nodes,
        { id: 'checkout', status: 'new' }, { id: 'made-up', status: 'modified' },
        { id: 'proposal:bad-group', status: 'new', group: 'missing' },
        { id: 'proposal:bad-status', status: { toString: 'unsafe' } },
    ], edges: [...rawProposal.edges,
        { from: 'checkout', to: 'orders', status: 'new' },
        { from: 'orders', to: 'checkout', status: 'removed' },
        { from: 'missing', to: 'checkout', status: 'new' },
    ] }, map);
    assert.equal(result.nodes.length, 2);
    assert.equal(result.edges.length, 2);
    assert.equal(result.nodes[0].group, 'shop');
    assert.equal(result.nodes[1].suggestedPath, 'src/coupons.mjs');
    assert.deepEqual(normalizeProposal(result, map), result, 'normalization is stable');
    const before = JSON.stringify(map);
    const view = proposalMap(map, result);
    assert.equal(view.nodes.length, 3);
    assert.equal(view.edges[0].status, 'modified');
    assert.equal(view.nodes[0].path, 'src/');
    assert.equal(view.nodes[0].status, 'modified');
    assert.equal(JSON.stringify(map), before, 'composing a proposal never mutates the base map');
    assert.equal(proposalMap(map, normalizeProposal({}, map)).nodes.length, 2);
});

test('flow normalization, layout, SVG and Mermaid retain distinct proposed changes', () => {
    const cleaned = normalizeFlow(flow, 2);
    assert.equal(cleaned.nodes[1].status, 'new');
    assert.equal(cleaned.nodes[1].inferred, undefined);
    const layout = layoutFlow(cleaned), svg = renderFlowSvg(layout);
    assert.match(svg, /change-new/);
    assert.match(svg, /\[New\]/);
    assert.match(svg, /Modified/);
    assert.equal(layout.edges[0].status, 'new');
    const mermaid = flowToMermaid(cleaned);
    assert.match(mermaid, /\[New\] Validate coupon/);
    assert.match(mermaid, /class n2 new/);
    assert.match(mermaid, /\|"New"\|/);
    assert.equal(normalizeFlow({ ...flow, nodes: [{ id: 's', label: 'Start', status: 'bogus' }, flow.nodes[1]] }).nodes[0].status, undefined);
});

test('proposal prompts distinguish evidence from design and preserve it for redraw and planning', () => {
    const proposal = normalizeProposal(rawProposal, map);
    const trace = { intent: 'proposal', proposal, prompt: 'Where would coupons fit?', steps: [{ id: 'proposal:coupons', note: 'Validate coupons' }] };
    assert.match(classifyPrompt('How does checkout work, and where would coupons fit?'), /Mixed.*proposals/);
    assert.match(tracePrompt(config, map, trace.prompt, { intent: 'proposal', flow: true }), /never invented files or line numbers/);
    assert.match(tracePrompt(config, map, trace.prompt, { intent: 'auto' }), /Determine description or proposal/);
    assert.match(flowPrompt(config, map, trace), /This is a PROPOSAL/);
    assert.match(flowPrompt(config, map, trace), /Coupons \[proposal:coupons\]/);
    assert.match(planPrompt(config, map, trace), /Preserve the proposed design/);
    assert.equal(normalizePlan({ tasks: [] }), null);
    assert.equal(normalizePlan(plan).tasks.length, 1);
});

const selection = { agent: { id: 'claude', models: [{ id: 'opus' }, { id: 'haiku' }], efforts: ['low', 'high'] }, model: 'opus', effort: 'high', label: 'Test agent' };
const traceArgs = { root: '.', config, map, question: 'Add coupons', flow: true, selection, onProgress() {} };

test('classifier stays with the selected provider, uses explicit small models and honors overrides', () => {
    assert.deepEqual(classifierPick(selection), { agent: 'claude', model: 'haiku', effort: 'low' });
    assert.equal(classifierPick(selection, { model: 'custom', effort: 'high' }).model, 'custom');
    assert.equal(classifierPick({ ...selection, agent: { ...selection.agent, id: 'command' } }).model, 'opus');
});

for (const answer of ['proposal', 'description', 'invalid', 'error']) {
    test(`routing handles ${answer} and counts usage from both requests`, async () => {
        const prompts = [], picks = [];
        const runner = runTrace({ ...traceArgs, resolve: async (cfg, { pick }) => { picks.push(pick);return selection; },
            run: (sel, opts) => {
                prompts.push(opts.prompt);
                if (prompts.length === 1) return { kill() {}, promise: answer === 'error' ? Promise.reject(new Error('Classifier unavailable')) : Promise.resolve({ text: JSON.stringify({ intent: answer }), tokens: 3, cost: 0.01, turns: 1 }) };
                return { kill() {}, promise: Promise.resolve({ text: JSON.stringify({ intent: 'proposal', steps: [], proposal: rawProposal }), tokens: 7, cost: 0.02, turns: 2 }) };
            } });
        const result = await runner.promise;
        assert.equal(prompts.length, 2);
        assert.equal(picks[0].agent, 'claude');
        assert.equal(result.trace.intent, answer === 'description' ? 'description' : 'proposal');
        assert.equal(result.tokens, answer === 'error' ? 7 : 10);
        assert.equal(result.turns, answer === 'error' ? 2 : 3);
        assert.match(prompts[1], answer === 'invalid' || answer === 'error' ? /Determine description or proposal/ : new RegExp(`INTENT: ${answer}`));
    });
}

test('Stop during classification kills the active request and prevents the main run', async () => {
    let started, reject, killed = false, calls = 0;
    const ready = new Promise((r) => { started = r; });
    const runner = runTrace({ ...traceArgs, resolve: async () => selection, run: () => {
        calls++;started();
        return { promise: new Promise((r, fail) => { reject = fail; }), kill: () => { killed = true;reject(new Error('Stopped')); } };
    } });
    await ready;runner.kill();
    await assert.rejects(runner.promise, (err) => err.code === 'stopped');
    assert.equal(killed, true);assert.equal(calls, 1);
});

test('Stop during provider resolution never starts a runner', async () => {
    let resolve;
    const runner = runTrace({ ...traceArgs, resolve: () => new Promise((r) => { resolve = r; }), run: () => assert.fail('must not start') });
    runner.kill();resolve(selection);
    await assert.rejects(runner.promise, (err) => err.code === 'stopped');
});

test('server routes proposals, validates refs, redraws and generates retained plans without editing the map', { timeout: 20000 }, async (t) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'repo-map-proposal-'));
    cpSync(new URL('../examples/shop/', import.meta.url), dir, { recursive: true });
    const mapFile = path.join(dir, '.repo-map', 'map.json'), originalMap = readFileSync(mapFile, 'utf8');
    const original = JSON.parse(originalMap), checkout = original.nodes.find((n) => n.id === 'checkout-page');
    const proposal = { ...rawProposal, nodes: [
        { id: checkout.id, status: 'modified', rationale: 'Accept coupons.' },
        { ...rawProposal.nodes[1], group: checkout.group },
    ], edges: [{ from: checkout.id, to: 'proposal:coupons', status: 'new' }] };
    const requests = [];
    const fake = createServer((req, res) => {
        let buffer = '';req.on('data', (b) => { buffer += b; });req.on('end', () => {
            if (req.method === 'GET') return res.end(JSON.stringify({ data: [{ id: 'fake' }, { id: 'small' }] }));
            const body = JSON.parse(buffer), prompt = body.messages.at(-1).content;requests.push(body);
            let out;
            if (prompt.startsWith('Classify')) out = { intent: 'proposal' };
            else if (prompt.startsWith('Create an implementation plan')) out = plan;
            else if (prompt.startsWith('You are drawing')) out = { flow };
            else out = { title: 'Coupons', summary: 'Add coupons to checkout.', proposal, steps: [
                { id: checkout.id, note: 'Accept a code', refs: [{ path: '.env', start: 1, end: 2 }] },
                { id: 'proposal:coupons', note: 'Validate the code', refs: [{ path: 'missing-file.mjs', start: 1, end: 2 }] },
            ], edges: [[checkout.id, 'proposal:coupons']], flow };
            res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) } }], usage: { total_tokens: 4 } }));
        });
    });
    await new Promise((r) => fake.listen(0, '127.0.0.1', r));
    writeFileSync(path.join(dir, '.repo-map', 'local.json'), JSON.stringify({ ai: { provider: 'api', classify: { model: 'small' }, api: { baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model: 'fake' } } }));
    let server;
    t.after(() => { server?.closeAllConnections();server?.close();fake.closeAllConnections();fake.close();rmSync(dir, { recursive: true, force: true }); });
    ({ server } = await startServer({ root: dir, port: 49000 + Math.floor(Math.random() * 1000), findFreePort: true }));
    const base = `http://127.0.0.1:${server.address().port}`, headers = { 'x-map': '1', 'content-type': 'application/json' };
    const post = (url, body) => fetch(base + url, { method: 'POST', headers, body: JSON.stringify(body) });
    const result = async (res) => {
        const text = await res.text();assert.equal(res.status, 200, text);
        const event = text.trim().split('\n').map((s) => JSON.parse(s)).find((e) => e.type === 'result' || e.type === 'error');
        assert.ok(event, text);return event;
    };
    const created = await result(await post('/api/trace', { prompt: 'Where would coupons fit?', flow: true }));
    assert.equal(created.type, 'result');assert.equal(created.trace.intent, 'proposal');
    assert.equal(created.trace.proposal.nodes.length, 2);assert.equal(created.tokens, 8);
    assert.deepEqual(created.trace.steps.map((s) => s.refs), [[], []]);
    assert.equal(requests[0].model, 'small');assert.equal(requests[0].tools, undefined);
    assert.equal(requests[1].model, 'fake');assert.ok(requests[1].tools.length);
    const trace = created.trace;
    const redrawn = await result(await post('/api/flow', { trace }));
    assert.equal(redrawn.flow.nodes[1].status, 'new');
    const expanded = await result(await post('/api/plan', { trace }));
    assert.equal(expanded.type, 'result');assert.equal(expanded.plan.tasks.length, 1);
    const { key } = await (await post('/api/traces', { ...trace, plan: expanded.plan })).json();
    const saved = (await (await fetch(`${base}/api/traces`, { headers })).json()).traces.find((t) => t.key === key);
    assert.deepEqual(saved.plan, expanded.plan);assert.deepEqual(saved.proposal, trace.proposal);
    assert.equal(requests.filter((r) => r.messages.at(-1).content.startsWith('Classify')).length, 1, 'redraw and plan do not reclassify');
    assert.equal((await post('/api/plan', { trace: { ...trace, intent: 'description' } })).status, 400);
    assert.equal((await post('/api/plan', { trace, model: '--bad' })).status, 400);
    assert.equal((await fetch(`${base}/api/plan`, { method: 'POST', body: '{}' })).status, 403);
    assert.equal((await fetch(`${base}/lib/proposal.mjs`)).status, 200);
    assert.equal(readFileSync(mapFile, 'utf8'), originalMap);
});

import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { layoutFlow, placeRow, renderFlowSvg, wrap } from '../app/flowchart.mjs';
import { withDefaults } from '../lib/config.mjs';
import { flowToMermaid, normalizeFlow } from '../lib/flow.mjs';
import { flowPrompt, tracePrompt } from '../lib/prompts.mjs';
import { startServer } from '../lib/server.mjs';

const EXAMPLE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'shop');

const CHECKOUT = {
    nodes: [
        { id: 's', type: 'start', label: 'Shopper opens checkout', step: 1 },
        { id: 'd1', type: 'decision', label: 'Is the cart empty?', step: 2 },
        { id: 'e1', type: 'error', label: 'Show empty cart message' },
        { id: 'p1', type: 'process', label: 'Charge the card', step: 3 },
        { id: 'd2', type: 'decision', label: 'Approved?' },
        { id: 'a1', type: 'action', label: 'Shopper edits card details' },
        { id: 'end', type: 'end', label: 'Show confirmation' },
    ],
    edges: [
        { from: 's', to: 'd1' },
        { from: 'd1', to: 'e1', label: 'yes' },
        { from: 'd1', to: 'p1', label: 'no' },
        { from: 'p1', to: 'd2' },
        { from: 'd2', to: 'end', label: 'yes' },
        { from: 'd2', to: 'a1', label: 'declined' },
        { from: 'a1', to: 'p1', label: 'retry' },
        { from: 'e1', to: 'end', inferred: true },
    ],
};

test('normalizeFlow cleans what an AI tool returns', () => {
    const f = normalizeFlow({
        nodes: [
            { id: 'a', type: 'start', label: '  Begin  ', step: 9 },
            { id: 'a', type: 'weird', label: 'Second with same id', step: 2 },
            { id: 'c', label: '' },
            { id: 'd b', type: 'end', label: 'Done', inferred: true },
        ],
        edges: [{ from: 'a', to: 'db' }, { from: 'a', to: 'a' }, { from: 'a', to: 'db' }, { from: 'x', to: 'a' }, { from: 'a', to: 'db', label: 'dupe' }],
    }, 3);
    assert.deepEqual(f.nodes.map((n) => n.id), ['a', 'a-2', 'db']);
    assert.equal(f.nodes[0].label, 'Begin');
    assert.equal(f.nodes[0].step, undefined, 'step beyond the trace is dropped');
    assert.equal(f.nodes[1].type, 'process');
    assert.equal(f.nodes[1].step, 2);
    assert.equal(f.nodes[2].inferred, true);
    assert.deepEqual(f.edges, [{ from: 'a', to: 'db' }]);
    assert.equal(normalizeFlow({ nodes: [{ id: 'x', label: 'Only' }], edges: [] }), null);
    assert.equal(normalizeFlow(null), null);
    assert.equal(normalizeFlow({ nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], edges: [] }), null);
});

test('flowToMermaid uses flowchart shapes and quotes labels', () => {
    const src = flowToMermaid(normalizeFlow({
        nodes: [{ id: 's', type: 'start', label: 'Say "hi"' }, { id: 'd', type: 'decision', label: 'OK?' }, { id: 'e', type: 'error', label: 'Fail' }],
        edges: [{ from: 's', to: 'd' }, { from: 'd', to: 'e', label: 'no', inferred: true }],
    }), 'Greeting');
    assert.match(src, /^---\ntitle: Greeting\n---\nflowchart TD/);
    assert.match(src, /n1\(\["Say #quot;hi#quot;"\]\)/);
    assert.match(src, /n2\{"OK\?"\}/);
    assert.match(src, /n2 -\.->\|"no"\| n3/);
    assert.match(src, /class n3 err/);
});

test('placeRow keeps order and gaps while staying close to targets', () => {
    assert.deepEqual(placeRow([0, 0, 0], [0, 10, 10]), [-10, 0, 10]);
    assert.deepEqual(placeRow([0, 100], [0, 10]), [0, 100]);
});

test('wrap breaks labels on words', () => {
    assert.deepEqual(wrap('Charge the card through the payments API', 16), ['Charge the card', 'through the', 'payments API']);
});

test('layoutFlow ranks top to bottom, draws loops as return arrows, and never overlaps boxes', () => {
    const L = layoutFlow(normalizeFlow(CHECKOUT));
    const at = Object.fromEntries(L.nodes.map((n) => [n.id, n]));
    assert.ok(at.s.y < at.d1.y && at.d1.y < at.p1.y && at.p1.y < at.d2.y && at.d2.y < at.end.y);
    const back = L.edges.filter((e) => e.back);
    assert.equal(back.length, 1);
    assert.deepEqual([back[0].from, back[0].to], ['a1', 'p1']);
    for (let i = 0; i < L.nodes.length; i++) {
        for (let j = i + 1; j < L.nodes.length; j++) {
            const a = L.nodes[i];
            const b = L.nodes[j];
            assert.ok(!(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h), `${a.id} overlaps ${b.id}`);
        }
    }
    for (const n of L.nodes) {
        assert.ok(n.x >= 0 && n.y >= 0 && n.x + n.w <= L.width && n.y + n.h <= L.height, `${n.id} inside the canvas`);
    }
    const svg = renderFlowSvg(L, { title: 'Checkout' });
    assert.match(svg, /^<svg[^>]+viewBox="0 0 \d+ \d+"/);
    assert.equal((svg.match(/class="fn /g) || []).length, 7);
    assert.doesNotMatch(svg, /data-step=|class="fb"|\(step \d+\)/);
    assert.match(svg, />declined</);
});

test('layoutFlow survives cycles without a start box and disconnected boxes', () => {
    const L = layoutFlow({
        nodes: [{ id: 'a', type: 'process', label: 'A' }, { id: 'b', type: 'process', label: 'B' }, { id: 'c', type: 'process', label: 'C' }, { id: 'z', type: 'end', label: 'Alone' }],
        edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }],
    });
    assert.equal(L.nodes.length, 4);
    assert.equal(L.edges.filter((e) => e.back).length, 1);
    assert.ok(L.edges.every((e) => !/NaN|undefined/.test(e.d)));
});

test('trace prompt asks for a flowchart only when requested; flowPrompt carries the trace', () => {
    const config = withDefaults({ name: 'Shop' }, {});
    const map = { groups: [], nodes: [{ id: 'cart', title: 'Cart', path: 'src/cart' }], edges: [] };
    assert.doesNotMatch(tracePrompt(config, map, 'Q'), /"flow"/);
    assert.match(tracePrompt(config, map, 'Q', { flow: true }), /"flow":\{"nodes"/);
    const p = flowPrompt(config, map, { title: 'Cart', prompt: 'How does the cart work?', steps: [{ id: 'cart', note: 'Holds items' }], refs: [{ step: 'cart', path: 'src/cart/a.js', start: 3, end: 9, why: 'add()' }] });
    assert.match(p, /PROCESS: How does the cart work\?/);
    assert.match(p, /1\. Cart \[cart, src\/cart\]: Holds items\n {4}code: src\/cart\/a\.js lines 3-9 \(add\(\)\)/);
});

test('server: traces carry flowcharts, /api/flow draws one, PUT keeps createdAt, modules are served', async (t) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'repo-map-flow-'));
    cpSync(EXAMPLE, dir, { recursive: true });
    rmSync(path.join(dir, '.repo-map', 'traces'), { recursive: true, force: true });
    const fake = createServer((req, res) => {
        let b = '';
        req.on('data', (c) => { b += c; });
        req.on('end', () => {
            if (req.method === 'GET') {
                res.end(JSON.stringify({ data: [{ id: 'fake' }] })); // GET /models
                return;
            }
            const prompt = JSON.parse(b).messages.map((m) => m.content).join('\n');
            const out = prompt.startsWith('You are drawing a flowchart')
                ? { flow: CHECKOUT }
                : { title: 'Order', summary: 's', steps: [{ id: 'shopper', note: 'n' }, { id: 'checkout-page', note: 'n' }, { id: 'orders-client', note: 'n' }], edges: [], gaps: '', flow: CHECKOUT };
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(out) }, finish_reason: 'stop' }] }));
        });
    });
    await new Promise((r) => fake.listen(0, '127.0.0.1', r));
    writeFileSync(path.join(dir, '.repo-map', 'local.json'), JSON.stringify({ ai: { provider: 'api', api: { baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model: 'fake' } } }));
    const { server, port } = await startServer({ root: dir, port: 47000 + Math.floor(Math.random() * 1000), findFreePort: true });
    t.after(() => {
        server.close();
        fake.close();
    });
    const base = `http://127.0.0.1:${port}`;
    const H = { 'x-map': '1', 'content-type': 'application/json' };
    const lastResult = async (res) => (await res.text()).trim().split('\n').map((l) => JSON.parse(l)).find((e) => e.type === 'result' || e.type === 'error');

    const withFlow = await lastResult(await fetch(`${base}/api/trace`, { method: 'POST', headers: H, body: JSON.stringify({ prompt: 'Place an order', flow: true }) }));
    assert.equal(withFlow.type, 'result');
    assert.equal(withFlow.trace.flow.nodes.length, 7);
    assert.equal(withFlow.trace.flow.nodes[3].step, 3);
    assert.equal(withFlow.trace.flow.nodes[0].step, 1);
    const noFlow = await lastResult(await fetch(`${base}/api/trace`, { method: 'POST', headers: H, body: JSON.stringify({ prompt: 'Place an order' }) }));
    assert.equal(noFlow.trace.flow, null, 'no flowchart unless asked');

    const drawn = await lastResult(await fetch(`${base}/api/flow`, { method: 'POST', headers: H, body: JSON.stringify({ trace: noFlow.trace }) }));
    assert.equal(drawn.type, 'result');
    assert.equal(drawn.flow.edges.length, 8);
    assert.equal((await fetch(`${base}/api/flow`, { method: 'POST', headers: H, body: '{}' })).status, 400);

    const { key } = await (await fetch(`${base}/api/traces`, { method: 'POST', headers: H, body: JSON.stringify({ ...noFlow.trace, createdAt: 123 }) })).json();
    const outputs = { architecture: false, flowchart: true };
    const put = await fetch(`${base}/api/traces/${key}`, { method: 'PUT', headers: H, body: JSON.stringify({ ...noFlow.trace, flow: drawn.flow, outputs, createdAt: 999 }) });
    assert.equal(put.status, 200);
    const saved = JSON.parse(readFileSync(path.join(dir, '.repo-map', 'traces', `${key}.json`), 'utf8'));
    assert.equal(saved.createdAt, 123);
    assert.equal(saved.flow.nodes.length, 7);
    assert.deepEqual(saved.outputs, outputs);
    const listed = (await (await fetch(`${base}/api/traces`, { headers: H })).json()).traces;
    assert.deepEqual(listed.find(trace => trace.key === key).outputs, outputs);
    assert.equal(readdirSync(path.join(dir, '.repo-map', 'traces')).length, 1);
    assert.equal((await fetch(`${base}/api/traces/00000000-0000-0000-0000-000000000000`, { method: 'PUT', headers: H, body: '{}' })).status, 404);

    // the picker: agents with their models, and picks checked before anything runs
    const agents = await (await fetch(`${base}/api/agents`, { headers: H })).json();
    const api = agents.agents.find((a) => a.id === 'api');
    assert.equal(api.available, true);
    assert.ok(api.models.some((m) => m.id === 'fake'));
    assert.deepEqual(agents.default, { agent: 'api', model: 'fake', effort: '' });
    assert.equal(JSON.stringify(agents).includes('baseUrl'), false, 'no settings leak to the browser');
    const post = (body) => fetch(`${base}/api/trace`, { method: 'POST', headers: H, body: JSON.stringify({ prompt: 'Place an order', ...body }) });
    assert.equal((await post({ agent: 'api', model: '--dangerous' })).status, 400);
    assert.equal((await post({ agent: 'not-a-tool' })).status, 400);
    assert.equal((await post({ agent: 'api', effort: 'ludicrous' })).status, 400);
    const picked = await lastResult(await post({ agent: 'api', model: 'other-model' }));
    assert.equal(picked.type, 'result');
    assert.deepEqual({ ...picked.used, label: undefined }, { agent: 'api', model: 'other-model', effort: '', label: undefined });

    const mod = await fetch(`${base}/app/flowchart.mjs`);
    assert.equal(mod.status, 200);
    assert.match(mod.headers.get('content-type'), /javascript/);
    assert.equal((await fetch(`${base}/lib/server.mjs`)).status, 404, 'only the browser modules are served');
});

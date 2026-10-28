import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { anchorBranchCaptions, fitCaptions, layoutFlow, placeRow, renderFlowSvg, wrap } from '../app/flowchart.mjs';
import { withDefaults } from '../lib/config.mjs';
import { countInferred, flowLanes, flowRepos, flowToMermaid, normalizeFlow } from '../lib/flow.mjs';
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

test('lane metadata is optional, bounded, and preserves independent proposal and inference flags', () => {
    const flow = normalizeFlow({ ...CHECKOUT,
        lanes: [{ id: 'web', label: 'Frontend' }, { id: 'api', label: 'Backend' }, { id: 'api', label: 'Duplicate' }, { id: 'unused', label: 'Unused' }, { id: '<bad>', label: 'Invalid' }],
        nodes: CHECKOUT.nodes.map((node, i) => ({ ...node, lane: i === 0 ? 'missing' : i % 2 ? 'web' : 'api', status: 'modified', inferred: true })),
    });
    assert.deepEqual(flow.lanes.map((lane) => lane.id), ['web', 'api']);
    assert.equal(flow.nodes[0].lane, undefined);
    assert.equal(flow.nodes[1].lane, 'web');
    assert.equal(flow.nodes[1].status, 'modified');
    assert.equal(flow.nodes[1].inferred, true);
    assert.deepEqual(normalizeFlow(JSON.parse(JSON.stringify(flow))), flow);
    const source = flowToMermaid(flow);
    assert.match(source, /subgraph lane1\["Frontend"\]/);
    assert.match(source, /subgraph lane3\["Unassigned"\]/);
    assert.equal((source.match(/n\d+\(\[|n\d+\[|n\d+\{/g) || []).length, flow.nodes.length);
});

test('execution lanes contain branches and long labels, preserve loops, and allow compact layout', () => {
    const flow = normalizeFlow({ ...CHECKOUT,
        lanes: [{ id: 'web', label: 'Frontend' }, { id: 'api', label: 'Backend' }, { id: 'worker', label: 'Payment processing worker' }],
        nodes: CHECKOUT.nodes.map((node, i) => ({ ...node, lane: ['web', 'api', 'api', 'worker', 'worker', undefined, 'web'][i] })),
    });
    const layout = layoutFlow(flow);
    assert.equal(layout.lanes.length, 4);
    for (const node of layout.nodes) {
        const lane = layout.lanes.find((item) => item.id === (node.lane || ''));
        assert.ok(node.x >= lane.x && node.x + node.w <= lane.x + lane.w, node.id);
        assert.ok(node.y > 48);
        assert.ok(Number.isFinite(node.cx) && Number.isFinite(node.cy));
        for (const other of layout.nodes.filter((item) => item.id !== node.id)) {
            assert.ok(node.x + node.w <= other.x || other.x + other.w <= node.x || node.y + node.h <= other.y || other.y + other.h <= node.y);
        }
    }
    assert.equal(layout.edges.filter((edge) => edge.back).length, 1);
    assert.ok(layout.edges.every((edge) => !/NaN|Infinity/.test(edge.d)));
    assert.match(renderFlowSvg(layout), /execution-lane/);
    assert.match(renderFlowSvg(layout), /Unassigned/);
    assert.equal(layoutFlow(flow, { lanes: false }).lanes.length, 0);
    assert.equal(layoutFlow(normalizeFlow(CHECKOUT)).lanes.length, 0);
    const single = normalizeFlow({ ...CHECKOUT, lanes: [{ id: 'web', label: 'Frontend' }], nodes: CHECKOUT.nodes.map((node) => ({ ...node, lane: 'web' })) });
    assert.equal(layoutFlow(single).lanes.length, 0);
});

test('lane decision labels stay distinct when both branches cross to the right', () => {
    const flow = normalizeFlow({
        lanes: [{ id: 'api', label: 'Backend' }, { id: 'worker', label: 'Worker' }, { id: 'web', label: 'Frontend' }],
        nodes: [{ id: 'decision', type: 'decision', label: 'Valid?', lane: 'api' },
            { id: 'yes', label: 'Process', lane: 'worker' }, { id: 'no', label: 'Show error', lane: 'web' }],
        edges: [{ from: 'decision', to: 'yes', label: 'yes' }, { from: 'decision', to: 'no', label: 'no' }],
    });
    const layout = layoutFlow(flow);
    const [yes, no] = layout.edges;
    assert.ok(Math.abs(yes.labelAt[0] - no.labelAt[0]) > 40, 'branch labels must not overlap');
});

test('wrap breaks labels on words', () => {
    assert.deepEqual(wrap('Charge the card through the payments API', 16), ['Charge the card', 'through the', 'payments API']);
});

test('same-lane returns and captions stay in clear, separate corridors inside their lane', () => {
    const flow = normalizeFlow({
        lanes: [{ id: 'web', label: 'Frontend' }, { id: 'api', label: 'Orders API' }],
        nodes: ['a', 'b', 'c', 'd', 'api'].map((id) => ({ id, label: id, lane: id === 'api' ? 'api' : 'web', type: id === 'a' ? 'start' : 'decision' })),
        edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd' }, { from: 'd', to: 'api' },
            { from: 'c', to: 'a', label: 'no' }, { from: 'd', to: 'b', label: 'Edit email and retry', status: 'modified' },
            { from: 'api', to: 'a', label: 'server declined' }],
    });
    const layout = layoutFlow(flow);
    const web = layout.lanes[0];
    const returns = layout.edges.filter((edge) => edge.back && edge.from !== 'api');
    assert.equal(returns.length, 2);
    assert.notEqual(returns[0].labelAt[0], returns[1].labelAt[0], 'overlapping returns have separate corridors');
    for (const edge of returns) {
        const points = [...edge.d.matchAll(/[ML]([\d.]+),([\d.]+)/g)].map((match) => [Number(match[1]), Number(match[2])]);
        assert.equal(points.length, 6);
        assert.ok(points.every(([x]) => x >= web.x && x <= web.x + web.w));
        const caption = (edge.status ? 'Modified: ' : '') + edge.label;
        assert.ok(edge.labelAt[0] + caption.length * 6.1 + 10 <= web.x + web.w, 'caption fits inside lane');
        for (let index = 1; index < points.length; index++) {
            const [a, b] = [points[index - 1], points[index]];
            for (const node of layout.nodes) {
                const crosses = a[0] === b[0]
                    ? a[0] > node.x && a[0] < node.x + node.w && Math.min(a[1], b[1]) < node.y + node.h && Math.max(a[1], b[1]) > node.y
                    : a[1] > node.y && a[1] < node.y + node.h && Math.min(a[0], b[0]) < node.x + node.w && Math.max(a[0], b[0]) > node.x;
                assert.equal(crosses, false, `${edge.from} -> ${edge.to} avoids ${node.id}`);
            }
        }
    }
    const crossLane = layout.edges.find((edge) => edge.from === 'api');
    assert.ok(crossLane.labelAt[0] > layout.lanes.at(-1).x + layout.lanes.at(-1).w);
    assert.match(renderFlowSvg(layout), /Modified: Edit email and retry/);
    assert.equal(layoutFlow(flow, { lanes: false }).lanes.length, 0);
});

test('vertically separate same-lane returns reuse a corridor', () => {
    const layout = layoutFlow(normalizeFlow({
        lanes: [{ id: 'web', label: 'Frontend' }, { id: 'api', label: 'Backend' }],
        nodes: ['a', 'b', 'c', 'd', 'api'].map((id) => ({ id, label: id, lane: id === 'api' ? 'api' : 'web' })),
        edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd' }, { from: 'd', to: 'api' },
            { from: 'b', to: 'a', label: 'retry' }, { from: 'd', to: 'c', label: 'no' }],
    }));
    const returns = layout.edges.filter((edge) => edge.back);
    assert.equal(returns.length, 2);
    assert.equal(returns[0].labelAt[0], returns[1].labelAt[0]);
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
            const prompt = JSON.parse(b).messages.at(-1).content;
            const out = prompt.startsWith('Classify') ? { intent: 'description', title: 'Order' }
                : prompt.startsWith('You are taking a closer look')
                ? { ...CLOSER, nodes: CLOSER.nodes.map((n) => ({ ...n, type: n.type === 'start' ? 'process' : n.type, refs: [{ path: 'src/nowhere.ts', start: 1, end: 3 }] })) }
                : prompt.startsWith('You are drawing a flowchart')
                ? { flow: CHECKOUT }
                : { intent: 'description', title: 'Order', summary: 's', steps: [{ id: 'shopper', note: 'n', refs: [] }, { id: 'checkout-page', note: 'n', refs: [] }, { id: 'orders-client', note: 'n', refs: [] }], edges: [], gaps: '', flow: CHECKOUT };
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

    const expand = (body) => fetch(`${base}/api/flow/expand`, { method: 'POST', headers: H, body: JSON.stringify(body) });
    const closer = await lastResult(await expand({ trace: withFlow.trace, node: 'p1' }));
    assert.equal(closer.type, 'result');
    assert.deepEqual(closer.expansion.exits, [{ to: 'd2', from: 'p1.3' }]);
    assert.ok(closer.expansion.nodes.every((n) => !n.refs), 'refs to missing files are dropped');
    assert.equal((await expand({ trace: withFlow.trace, node: 'p1.1' })).status, 400, 'one level only');
    assert.equal((await expand({ trace: noFlow.trace, node: 'p1' })).status, 400, 'needs a flowchart');

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

test('caption helpers keep captions on their paths and widen the canvas to fit', () => {
    const flow = {
        nodes: [{ id: 'a', type: 'decision', label: 'Pick?' }, { id: 'b', type: 'process', label: 'Left' }, { id: 'c', type: 'process', label: 'Right' }],
        edges: [{ from: 'a', to: 'b', label: 'a fairly long left branch caption' }, { from: 'a', to: 'c', label: 'an even longer right branch caption here' }],
    };
    const layout = layoutFlow(flow, { lanes: false });
    const before = layout.edges.map((e) => [...e.labelAt]);
    anchorBranchCaptions(layout);
    layout.edges.forEach((e, i) => {
        assert.ok(Math.abs(e.labelAt[0] - before[i][0]) <= 4, 'branch caption stays at its path point');
        assert.equal(e.labelAt[1], before[i][1]);
    });
    const anchored = layout.edges.map((e) => [...e.labelAt]);
    const width = layout.width;
    fitCaptions(layout);
    assert.deepEqual(layout.edges.map((e) => e.labelAt), anchored, 'fitCaptions never moves captions');
    assert.ok(layout.width >= width);
    for (const e of layout.edges) {
        const w = e.label.length * 6.1 + 10;
        const x = e.labelAt[2] === 'start' ? e.labelAt[0] : e.labelAt[2] === 'end' ? e.labelAt[0] - w : e.labelAt[0] - w / 2;
        assert.ok(x >= 0 && x + w <= layout.width, 'caption fits the canvas');
    }
    const svg = renderFlowSvg(layout);
    assert.ok(svg.lastIndexOf('class="fn') < svg.indexOf('class="fl-all"'), 'captions render above boxes');
});

test('countInferred counts inferred nodes and edges', () => {
    assert.equal(countInferred(null), 0);
    assert.equal(countInferred({
        nodes: [{ id: 'a', inferred: true }, { id: 'b' }],
        edges: [{ from: 'a', to: 'b', inferred: true }, { from: 'b', to: 'a' }],
    }), 2);
});

/** A flow across two repos: a frontend lane in this repo, two lanes in the linked API. */
const crossRepo = () => ({
    nodes: [
        { id: 'a', type: 'start', label: 'Shopper places order', lane: 'web' },
        { id: 'b', type: 'process', label: 'Save the order', lane: 'api' },
        { id: 'c', type: 'process', label: 'Queue the receipt', lane: 'worker' },
        { id: 'd', type: 'end', label: 'Order confirmed', lane: 'web' },
    ],
    edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd' }],
    lanes: [{ id: 'api', label: 'Orders API', repo: 'api' }, { id: 'web', label: 'Frontend', repo: 'home' },
        { id: 'worker', label: 'Worker', repo: 'api' }, { id: 'x', label: 'Unused', repo: 'api' }],
});
const REPOS = [{ name: 'home', title: 'Shop' }, { name: 'api', title: 'Shop API' }];

test('normalizeFlow keeps lane repos the workspace knows, and saved repos on reload', () => {
    const flow = normalizeFlow(crossRepo(), 4, { repos: REPOS });
    assert.deepEqual(flow.repos, [{ id: 'home', label: 'Shop' }, { id: 'api', label: 'Shop API' }]);
    assert.deepEqual(flow.lanes.map((l) => l.repo), ['api', 'home', 'api']);
    // unknown repo names are dropped from lanes
    const odd = normalizeFlow({ ...crossRepo(), lanes: crossRepo().lanes.map((l) => ({ ...l, repo: l.repo === 'api' ? 'nope' : l.repo })) }, 4, { repos: REPOS });
    assert.deepEqual(odd.repos, [{ id: 'home', label: 'Shop' }]);
    assert.ok(odd.lanes.every((l) => l.repo !== 'nope'));
    // a saved flow (no server repos) keeps its own
    assert.deepEqual(normalizeFlow(flow, 4), flow);
    // a home-only trace has no repos at all
    const plain = normalizeFlow(crossRepo(), 4);
    assert.equal(plain.repos, undefined);
    assert.ok(plain.lanes.every((l) => !l.repo));
});

test('lanes sit together per repo, inside one band each', () => {
    const flow = normalizeFlow(crossRepo(), 4, { repos: REPOS });
    assert.deepEqual(flowLanes(flow).map((l) => l.id), ['web', 'api', 'worker']);
    assert.deepEqual(flowRepos(flow), [{ id: 'home', label: 'Shop', lanes: ['web'] }, { id: 'api', label: 'Shop API', lanes: ['api', 'worker'] }]);
    const layout = layoutFlow(flow);
    assert.equal(layout.laneTop > 0, true);
    for (const band of layout.repoBands) {
        for (const lane of layout.lanes.filter((l) => band.lanes.includes(l.id))) {
            assert.ok(lane.x >= band.x && lane.x + lane.w <= band.x + band.w + 0.01, `${lane.id} inside ${band.id}`);
        }
    }
    assert.ok(layout.nodes.every((n) => n.y > layout.laneTop + 48), 'boxes start below both header rows');
    const svg = renderFlowSvg(layout);
    assert.equal((svg.match(/class="repo-band"/g) || []).length, 2);
    // one repo only: no bands
    const single = normalizeFlow({ ...crossRepo(), lanes: crossRepo().lanes.map((l) => ({ ...l, repo: 'home' })) }, 4, { repos: REPOS });
    assert.deepEqual(flowRepos(single), []);
    assert.deepEqual(layoutFlow(single).repoBands, []);
    assert.equal(layoutFlow(single).laneTop, 0);
});

test('Mermaid nests lane subgraphs inside repo subgraphs', () => {
    const text = flowToMermaid(normalizeFlow(crossRepo(), 4, { repos: REPOS }));
    const lines = text.split('\n').map((l) => l.trim());
    const api = lines.indexOf('subgraph repo2["Shop API"]');
    assert.ok(api > lines.indexOf('subgraph repo1["Shop"]'));
    assert.ok(lines.indexOf('subgraph lane2["Orders API"]') > api);
    assert.ok(lines.indexOf('subgraph lane3["Worker"]') > api);
});

test('lanes outside every repo sit in a last band, so every lane has one', () => {
    const raw = crossRepo();
    raw.lanes.push({ id: 'mail', label: 'Mail service' });
    raw.nodes.push({ id: 'm', type: 'process', label: 'Send receipt', lane: 'mail' });
    raw.edges.push({ from: 'c', to: 'm' });
    const flow = normalizeFlow(raw, 5, { repos: REPOS });
    const bands = flowRepos(flow);
    assert.deepEqual(bands.at(-1), { id: '~other', label: 'Outside services', lanes: ['mail'] });
    // an unassigned box joins it, and the band is then just "Other"
    flow.nodes.push({ id: 'u', type: 'process', label: 'Somewhere' });
    flow.edges.push({ from: 'm', to: 'u' });
    assert.deepEqual(flowRepos(flow).at(-1), { id: '~other', label: 'Other', lanes: ['mail', ''] });
    const layout = layoutFlow(flow);
    const covered = new Set(layout.repoBands.flatMap((b) => b.lanes));
    assert.ok(layout.lanes.every((l) => covered.has(l.id)));
    // bands never overlap
    const sorted = [...layout.repoBands].sort((a, b) => a.x - b.x);
    for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i].x >= sorted[i - 1].x + sorted[i - 1].w + 8);
});

const CLOSER = {
    summary: 'Charges the card through the payment provider.',
    gaps: '',
    nodes: [
        { id: 'x1', type: 'start', label: 'Build the payment request', refs: [{ path: 'src/pay.ts', start: 3, end: 9, why: 'builds it' }, { path: 'a', start: 1, end: 2 }, { path: 'b', start: 1, end: 2 }] },
        { id: 'x2', type: 'process', label: 'Send it to the provider', lane: 'nowhere' },
        { id: 'x3', type: 'decision', label: 'Provider answered in time?' },
        { id: 'x4', type: 'error', label: 'Record a timeout' },
    ],
    edges: [{ from: 'x1', to: 'x2' }, { from: 'x2', to: 'x3' }, { from: 'x3', to: 'x4', label: 'no' }, { from: 'x9', to: 'x1' }],
    entry: 'x1',
    exits: [{ arrow: 1, from: 'x3' }],
};

test('normalizeExpansion numbers sub-boxes under their box and maps arrows out', async () => {
    const { normalizeExpansion, expandable } = await import('../lib/flow-expand.mjs');
    const flow = { ...CHECKOUT, lanes: [{ id: 'backend', label: 'Backend' }], nodes: CHECKOUT.nodes.map((n) => (n.id === 'p1' ? { ...n, lane: 'backend' } : n)) };
    const exp = normalizeExpansion(CLOSER, flow, 'p1');
    assert.deepEqual(exp.nodes.map((n) => n.id), ['p1.1', 'p1.2', 'p1.3', 'p1.4']);
    assert.equal(exp.nodes[0].type, 'process', 'only the whole flow has a start');
    assert.equal(exp.nodes[1].lane, 'backend', 'unknown lanes fall back to the box\'s lane');
    assert.equal(exp.nodes[0].refs.length, 2);
    assert.equal(exp.edges.length, 3, 'arrows to unknown boxes are dropped');
    assert.equal(exp.entry, 'p1.1');
    assert.deepEqual(exp.exits, [{ to: 'd2', from: 'p1.3' }]);
    assert.equal(exp.inline, true);
    // saved form round-trips
    assert.deepEqual(normalizeExpansion(exp, flow, 'p1'), exp);
    // one level only, and a known box
    assert.equal(normalizeExpansion(CLOSER, flow, 'p1.1'), null);
    assert.equal(normalizeExpansion(CLOSER, flow, 'nope'), null);
    assert.equal(expandable(flow, 'p1'), true);
    // a decision's arrows that aren't matched leave it panel-only
    const d2 = normalizeExpansion({ ...CLOSER, exits: [{ arrow: 1, from: 'x3' }] }, flow, 'd2');
    assert.equal(d2.inline, false);
    // one sub-box that leads nowhere takes an unmatched arrow
    const sink = normalizeExpansion({ ...CLOSER, nodes: CLOSER.nodes.slice(0, 2), edges: [{ from: 'x1', to: 'x2' }], exits: [] }, flow, 'p1');
    assert.deepEqual(sink.exits, [{ to: 'd2', from: 'p1.2' }]);
    assert.equal(sink.inline, true);
});

test('expandFlow draws shown closer looks in place; layout frames and marks them', async () => {
    const { expandFlow, normalizeExpansions } = await import('../lib/flow-expand.mjs');
    const expansions = normalizeExpansions({ p1: CLOSER, bogus: CLOSER }, CHECKOUT);
    assert.deepEqual(Object.keys(expansions), ['p1']);
    const hidden = expandFlow(CHECKOUT, expansions, []);
    assert.equal(hidden.nodes.find((n) => n.id === 'p1').expandable, true);
    const flow = expandFlow(CHECKOUT, expansions, ['p1']);
    assert.ok(!flow.nodes.some((n) => n.id === 'p1'));
    assert.ok(flow.nodes.filter((n) => n.expansion === 'p1').every((n) => n.step === 3 && !n.refs));
    assert.ok(flow.edges.some((e) => e.from === 'd1' && e.to === 'p1.1' && e.label === 'no'), 'arrows in land on the entry');
    assert.ok(flow.edges.some((e) => e.from === 'a1' && e.to === 'p1.1'), 'loops back land on the entry too');
    assert.ok(flow.edges.some((e) => e.from === 'p1.3' && e.to === 'd2'), 'arrows out leave from their exit');
    assert.deepEqual(flow.expanded, [{ id: 'p1', label: 'Charge the card' }]);
    const layout = layoutFlow(flow);
    assert.equal(layout.frames.length, 1);
    const svg = renderFlowSvg(layout);
    assert.match(svg, /class="xp-frame" data-frame="p1"/);
    assert.match(svg, /class="xp-title" data-frame="p1"/);
    assert.match(svg, /Expanded: Charge the card/);
    assert.equal((svg.match(/class="fn t-\w+ xp/g) || []).length, 4);
    assert.match(renderFlowSvg(layoutFlow(hidden)), /class="xp-badge"/);
    const mermaid = flowToMermaid(flow);
    assert.match(mermaid, /subgraph xp1\["Expanded: Charge the card"\]/);
    assert.match(mermaid, /class n4,n5,n6,n7 xp/);
});

test('expandPrompt numbers the arrows out of the box', async () => {
    const { expandPrompt } = await import('../lib/prompts.mjs');
    const config = withDefaults({ name: 'Shop' });
    const trace = { prompt: 'Place an order', steps: [{ id: 'a', note: 'n' }, { id: 'b', note: 'n' }, { id: 'c', note: 'pays' }], refs: [{ step: 'c', path: 'src/pay.ts', start: 1, end: 9 }] };
    const text = expandPrompt(config, { nodes: [], edges: [] }, trace, CHECKOUT, 'd2');
    assert.match(text, /^You are taking a closer look/);
    assert.match(text, /BOX TO LOOK INSIDE: d2/);
    // caveats belong in gaps, not the summary
    assert.match(text, /"summary": 2-3 plain sentences[^\n]*No caveats[^\n]*go in "gaps"/);
    assert.match(text, /1\. to "Show confirmation" \(yes\)\n2\. to "Shopper edits card details" \(declined\)/);
    assert.match(expandPrompt(config, { nodes: [], edges: [] }, trace, CHECKOUT, 'p1'), /src\/pay\.ts lines 1-9/);
});

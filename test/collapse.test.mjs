import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutFlow, renderFlowSvg } from '../app/flowchart.mjs';
import { collapseGraph, collapsedOwner } from '../lib/collapse.mjs';
import { normalizeFlow } from '../lib/flow.mjs';

const FLOW = {
    nodes: [
        { id: 's', type: 'start', label: 'Open checkout', lane: 'web' },
        { id: 'a', type: 'process', label: 'Send order', lane: 'web' },
        { id: 'b', type: 'process', label: 'Validate', lane: 'api' },
        { id: 'c', type: 'decision', label: 'Card ok?', lane: 'api' },
        { id: 'ok', type: 'end', label: 'Order placed', lane: 'web' },
        { id: 'no', type: 'error', label: 'Card declined', lane: 'web' },
    ],
    edges: [
        { from: 's', to: 'a' },
        { from: 'a', to: 'b', label: 'POST /orders' },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'ok', label: 'yes' },
        { from: 'c', to: 'no', label: 'no' },
    ],
    lanes: [{ id: 'web', label: 'Frontend' }, { id: 'api', label: 'Backend' }],
};

test('collapseGraph folds members into one box and rewires edges', () => {
    const before = JSON.stringify(FLOW);
    const out = collapseGraph(FLOW, [{ id: 'api', label: 'Backend', members: ['b', 'c'] }]);
    assert.equal(JSON.stringify(FLOW), before, 'input unchanged');
    assert.deepEqual(out.nodes.map((n) => n.id), ['s', 'a', 'c:api', 'ok', 'no']);
    const box = out.nodes[2];
    assert.equal(box.collapsed, true);
    assert.equal(box.type, 'collapsed');
    assert.equal(box.lane, 'api');
    assert.deepEqual(box.members, ['b', 'c']);
    assert.deepEqual(out.edges.map((e) => `${e.from}>${e.to}:${e.label || ''}`),
        ['s>a:', 'a>c:api:POST /orders', 'c:api>ok:yes', 'c:api>no:no']);
    assert.equal(collapsedOwner(out, 'c'), 'c:api');
    assert.equal(collapsedOwner(out, 's'), null);
});

test('collapseGraph merges parallel edges and drops internal ones', () => {
    const out = collapseGraph(FLOW, [{ id: 'end', label: '', members: ['ok', 'no'] }]);
    const merged = out.edges.filter((e) => e.to === 'c:end');
    assert.equal(merged.length, 1);
    assert.equal(merged[0].label, 'yes / no');
    assert.equal(merged[0].merged, 2);
    assert.equal(out.nodes.at(-1).label, 'Order placed (+1 more)');
    assert.equal(out.nodes.at(-1).lane, 'web');
    const inner = collapseGraph(FLOW, [{ id: 'x', label: 'Middle', members: ['a', 'b', 'c'] }]);
    assert.ok(!inner.edges.some((e) => e.from === 'c:x' && e.to === 'c:x'));
    assert.equal(inner.nodes.find((n) => n.id === 'c:x').lane, undefined, 'mixed lanes leave lane unset');
});

test('collapseGraph ignores overlapping, unknown and one-member groups', () => {
    const out = collapseGraph(FLOW, [
        { id: 'one', members: ['a', 'b'] },
        { id: 'two', members: ['b', 'c'] },        // b taken: only c left, dropped
        { id: 'ghost', members: ['zz', 'yy'] },
        { id: 'one', members: ['ok', 'no'] },      // duplicate id
    ]);
    assert.deepEqual(out.nodes.filter((n) => n.collapsed).map((n) => n.id), ['c:one']);
    assert.equal(out.nodes.length, 5);
    assert.deepEqual(collapseGraph(FLOW, []).nodes, FLOW.nodes);
});

test('collapsed boxes lay out and render as a card stack', () => {
    const out = collapseGraph(FLOW, [{ id: 'api', label: 'Backend', members: ['b', 'c'] }]);
    const layout = layoutFlow(out);
    assert.equal(layout.lanes.length, 2);
    const svg = renderFlowSvg(layout);
    assert.match(svg, /class="fn t-collapsed" data-id="c:api"/);
    assert.match(svg, /class="fs-stack"/);
    assert.match(svg, /Backend · 2 steps/);
});

test('normalizeFlow drops chunks from older flowcharts', () => {
    const flow = normalizeFlow({ ...FLOW, chunks: [{ label: 'Backend check', nodes: ['b', 'c'] }] });
    assert.equal(flow.chunks, undefined);
});

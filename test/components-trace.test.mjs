import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { composeComponentsTrace, componentsTouched, normalizeComponentsTrace } from '../lib/components-trace.mjs';
import { withDefaults } from '../lib/config.mjs';
import { reviewPrompt, tracePrompt } from '../lib/prompts.mjs';
import { runReview } from '../lib/review.mjs';
import { startServer } from '../lib/server.mjs';
import { traceContext } from '../lib/trace-context.mjs';
import { traceOutputs } from '../lib/trace-outputs.mjs';

const ref = { path: 'src/pages/cart/CartPage.jsx', start: 1, end: 3, why: 'Cart page' };
const base = { version: 1, applicability: 'applicable', summary: 'Shop components', gaps: [],
    components: [
        { id: 'cart-page', label: 'CartPage', detail: 'Cart', tags: ['state'], refs: [ref] },
        { id: 'cart-line', label: 'CartLine', detail: 'One line', tags: [], refs: [{ ...ref, path: 'src/components/cart/CartLine.jsx' }] },
        { id: 'checkout-page', label: 'CheckoutPage', detail: 'Checkout', tags: ['form'], refs: [{ ...ref, path: 'src/pages/checkout/CheckoutPage.jsx' }] },
    ],
    uses: [{ from: 'cart-page', to: 'cart-line' }], screens: [{ screen: 'cart', root: 'cart-page' }] };
const raw = { version: 1, applicability: 'relevant', summary: 'Promo codes in the cart', gaps: [],
    involved: [{ id: 'cart-page', note: 'Shows the total', refs: [ref] }, { id: 'proposal-promo', note: 'Takes the code' }],
    changes: {
        components: [
            { id: 'proposal-promo', label: 'PromoField', detail: 'Promo input', tags: ['form', 'bogus'], status: 'new', rationale: 'Enter codes' },
            { id: 'cart-page', status: 'modified', rationale: 'Renders the promo field' },
            { id: 'cart-line', status: 'removed', rationale: 'Merged into the page' },
        ],
        uses: [
            { from: 'cart-page', to: 'proposal-promo', status: 'new', rationale: 'Renders it' },
            { from: 'cart-page', to: 'cart-line', status: 'removed' },
        ],
    } };
// the same output as the schema allows it on the wire
const wire = structuredClone(raw);
wire.changes.components[0].tags = ['form'];

test('components trace keeps valid proposal changes and composes them over an untouched base', () => {
    const before = structuredClone(base);
    const output = normalizeComponentsTrace(raw, base, 'proposal');
    assert.deepEqual(output.changes.components.map((c) => [c.id, c.status]), [['proposal-promo', 'new'], ['cart-page', 'modified'], ['cart-line', 'removed']]);
    assert.deepEqual(output.changes.components[0].tags, ['form']);
    // a modified component keeps its base fields unless the change replaces them
    assert.equal(output.changes.components[1].label, 'CartPage');
    assert.deepEqual(output.changes.components[1].refs, [ref]);
    assert.equal(output.changes.uses.length, 2);
    assert.deepEqual(output.involved.map((i) => i.id), ['cart-page', 'proposal-promo']);
    assert.deepEqual(output.gaps, []);
    assert.deepEqual(base, before);
    assert.equal(output.base.components.length, 3);
    assert.equal(output.base.commit, undefined);
    // a saved output re-normalizes to itself from its own base
    assert.deepEqual(normalizeComponentsTrace(JSON.parse(JSON.stringify(output)), null, 'proposal'), output);
    const composed = composeComponentsTrace(output);
    assert.deepEqual(composed.components.map((c) => c.id), ['cart-page', 'cart-line', 'checkout-page', 'proposal-promo']);
    assert.equal(composed.components[1].status, 'removed');
    assert.equal(composed.components[2].status, undefined);
    assert.deepEqual(composed.uses.map((u) => u.status), ['removed', 'new']);
    assert.deepEqual([...componentsTouched(output)].sort(), ['cart-line', 'cart-page', 'proposal-promo']);
});

test('descriptions drop changes; bad ids, links and unknown involved components become gaps', () => {
    const described = normalizeComponentsTrace(raw, base, 'description');
    assert.deepEqual(described.changes, { components: [], uses: [] });
    // proposal-promo is unknown without its change
    assert.deepEqual(described.involved.map((i) => i.id), ['cart-page']);
    assert.match(described.gaps.join(' '), /involved components were unknown/);
    const output = normalizeComponentsTrace({ ...raw, changes: {
        components: [
            { id: 'new-thing', label: 'No prefix', status: 'new' },
            { id: 'proposal-cart', label: 'Dup', status: 'new' },
            { id: 'cart-page', label: 'Not new', status: 'new' },
            { id: 'ghost', status: 'modified' },
            { id: 'proposal-ok', label: 'Ok', status: 'new', refs: [{ path: '../secret', start: 1, end: 2 }, { path: '.env', start: 1, end: 1 }] },
            { id: 'proposal-ok', label: 'Again', status: 'new' },
            { id: 'proposal-nolabel', status: 'new' },
        ],
        uses: [
            { from: 'cart-page', to: 'cart-line', status: 'new' },
            { from: 'cart-page', to: 'checkout-page', status: 'removed' },
            { from: 'cart-page', to: 'cart-page', status: 'new' },
            { from: 'cart-page', to: 'ghost', status: 'new' },
            { from: 'cart-page', to: 'cart-line', status: 'modified' },
            { from: 'checkout-page', to: 'proposal-ok', status: 'new' },
        ],
    } }, base, 'review');
    assert.deepEqual(output.changes.components.map((c) => c.id), ['proposal-cart', 'proposal-ok']);
    assert.deepEqual(output.changes.components[1].refs, []);
    assert.deepEqual(output.changes.uses, [{ from: 'checkout-page', to: 'proposal-ok', status: 'new', rationale: '' }]);
    assert.match(output.gaps.join(' '), /proposed component changes were invalid/);
});

test('none needs a summary and empties the rest; relevant needs something to show', () => {
    const none = normalizeComponentsTrace({ applicability: 'none', summary: 'Background job only.', involved: [{ id: 'cart-page', note: 'x' }],
        changes: { components: [{ id: 'cart-page', status: 'removed' }], uses: [] } }, base, 'proposal');
    assert.equal(none.applicability, 'none');
    assert.deepEqual(none.involved, []);
    assert.deepEqual(none.changes, { components: [], uses: [] });
    assert.equal(normalizeComponentsTrace({ applicability: 'none', summary: '' }, base), null);
    assert.equal(normalizeComponentsTrace({ applicability: 'relevant', summary: 'x', involved: [] }, base), null);
    assert.equal(normalizeComponentsTrace({ applicability: 'maybe', summary: 'x' }, base), null);
    assert.equal(normalizeComponentsTrace({ version: 2, applicability: 'none', summary: 'x' }, base), null);
    assert.equal(normalizeComponentsTrace(raw, null), null, 'no base, no output');
});

test('trace outputs, prompts and prior context carry components only when asked', () => {
    const output = normalizeComponentsTrace(raw, base, 'proposal');
    assert.deepEqual(traceOutputs({ intent: 'proposal', components: output }).components, true);
    assert.deepEqual(traceOutputs({ intent: 'proposal', components: output, outputs: { architecture: true, components: false } }).components, false);
    assert.equal(traceOutputs({ intent: 'proposal', components: {} }).components, false);
    assert.equal('components' in traceOutputs({}), false);

    const config = withDefaults({ name: 'shop' });
    const map = { groups: [], nodes: [], edges: [] };
    assert.doesNotMatch(tracePrompt(config, map, 'Add promo codes'), /BASE COMPONENTS/);
    const prompt = tracePrompt(config, map, 'Add promo codes', { components: base, intent: 'proposal',
        previousTrace: { prompt: 'Old', components: output } });
    assert.match(prompt, /BASE COMPONENTS/);
    assert.match(prompt, /"src\/pages\/cart\/CartPage\.jsx:1-3"/);
    assert.doesNotMatch(prompt, /"why":"Cart page"/, 'base refs are compact strings');
    assert.match(prompt, /"components":\{…\}/);
    assert.match(prompt, /PREVIOUS FINDINGS.*"involved":\[\{"id":"cart-page"/);

    assert.equal(traceContext({ prompt: 'Old', components: output }).components, undefined);
    const context = traceContext({ prompt: 'Old', components: output }, { components: {} });
    assert.deepEqual(context.components.involved[0], { id: 'cart-page', note: 'Shows the total' });
    assert.equal(context.components.components[0].id, 'proposal-promo');
    assert.equal(context.components.uses[1].status, 'removed');
    assert.doesNotMatch(JSON.stringify(context), /"base"|CheckoutPage/);
});

test('reviews list the components the diff touches and leave the output raw for the server', async () => {
    const config = withDefaults({ name: 'shop' });
    const map = { groups: [{ id: 'g', col: 0, title: 'G' }], nodes: [{ id: 'cart', group: 'g', kind: 'service' }], edges: [] };
    const source = { kind: 'refs', base: 'main', head: 'feature', baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40), mergeBase: 'a'.repeat(40), title: 'feature', commits: [] };
    const diff = { files: [{ path: 'src/pages/cart/CartPage.jsx', status: 'M', additions: 1, deletions: 0 }], stat: '', patch: '+x', skipped: [] };
    assert.doesNotMatch(reviewPrompt(config, map, source, diff), /COMPONENTS WHOSE CODE/);
    const prompt = reviewPrompt(config, map, source, diff, { components: base });
    assert.match(prompt, /COMPONENTS WHOSE CODE THE DIFF TOUCHES: cart-page\n/);
    assert.match(prompt, /use "changes" in components as a proposal would/);
    const reply = { title: 'Promo', summary: 'Adds promo.', risks: [], questions: [], gaps: '', steps: [], edges: [],
        changes: { nodes: [], edges: [] }, files: [], components: wire };
    const requests = [];
    const runner = runReview({ readRoot: '.', config, map, source, diff, components: base, flow: false, selection: { agent: { id: 'command' }, label: 'Test' },
        run: (_, request) => { requests.push(request); return { kill() {}, promise: Promise.resolve({ text: JSON.stringify(reply) }) }; } });
    const { trace } = await runner.promise;
    assert.deepEqual(trace.components, wire);
    assert.ok(requests[0].responseSchema.required.includes('components'));
    // a reply without the requested output is repaired
    const missing = runReview({ readRoot: '.', config, map, source, diff, components: base, flow: false, selection: { agent: { id: 'command' }, label: 'Test' },
        run: () => ({ kill() {}, promise: Promise.resolve({ text: JSON.stringify({ ...reply, components: undefined }) }) }) });
    await assert.rejects(missing.promise, { code: 'schema' });
});

test('Components API traces, redraws and plans without changing components.json', async (t) => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'repo-map-components-trace-'));
    cpSync(new URL('../examples/shop/', import.meta.url), root, { recursive: true,
        filter: (source) => !String(source).endsWith('components.json') && !String(source).includes(`${path.sep}traces`) });
    const prompts = [];
    let invalid = false;
    const output = { ...wire, involved: [{ id: 'cart-page', note: 'Shows the total', refs: [{ path: '.env', start: 1, end: 2 }, ref] }] };
    const fake = createServer((req, res) => {
        let buffer = '';
        req.on('data', (chunk) => { buffer += chunk; });
        req.on('end', () => {
            if (req.method === 'GET') return res.end(JSON.stringify({ data: [{ id: 'fake' }] }));
            const prompt = JSON.parse(buffer).messages.at(-1).content;
            prompts.push(prompt);
            const answer = prompt.startsWith('Classify') ? { intent: 'proposal', title: 'Promo codes' }
                : prompt.startsWith('Create an implementation plan') ? { summary: 'Add promo', tasks: [{ title: 'Add field', detail: 'Promo input', files: [] }], interfaces: [], tests: [], risks: [], questions: [] }
                : prompt.startsWith('Use read-only search') ? { components: invalid ? { applicability: 'relevant', summary: 'Nothing', involved: [], gaps: [], changes: { components: [], uses: [] } } : output }
                : prompt.startsWith('You are drawing a flowchart') ? { flow: { nodes: [{ id: 'a', type: 'start', label: 'Open cart' }, { id: 'b', type: 'end', label: 'Done' }], edges: [{ from: 'a', to: 'b' }] } }
                : { intent: 'proposal', title: 'Promo codes', summary: 'Promo', steps: [], edges: [], gaps: '', proposal: { nodes: [], edges: [] }, components: output };
            res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }));
        });
    });
    await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
    writeFileSync(path.join(root, '.repo-map/local.json'), JSON.stringify({ ai: { provider: 'api', api: { baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model: 'fake' } } }));
    const { server } = await startServer({ root, port: 49000 + Math.floor(Math.random() * 1000), findFreePort: true });
    t.after(() => { server.closeAllConnections(); server.close(); fake.closeAllConnections(); fake.close(); rmSync(root, { recursive: true, force: true }); });
    const url = `http://127.0.0.1:${server.address().port}`;
    const headers = { 'x-map': '1', 'content-type': 'application/json' };
    const post = (endpoint, body) => fetch(url + endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    const result = async (response) => (await response.text()).trim().split('\n').map(JSON.parse).find((e) => ['result', 'error'].includes(e.type));

    const refused = await post('/api/trace', { prompt: 'Add promo codes', components: true });
    assert.equal(refused.status, 400);
    assert.match((await refused.json()).error, /component map/);
    assert.equal((await post('/api/trace/components', { trace: { prompt: 'x', steps: [] } })).status, 400);
    assert.equal(prompts.length, 0);

    writeFileSync(path.join(root, '.repo-map/components.json'), JSON.stringify(base));
    const before = readFileSync(path.join(root, '.repo-map/components.json'), 'utf8');
    const created = await result(await post('/api/trace', { prompt: 'Add promo codes', components: true, architecture: false }));
    assert.equal(created.type, 'result');
    assert.equal(created.trace.components.changes.components[0].id, 'proposal-promo');
    assert.equal(created.trace.components.involved[0].refs.length, 1, '.env ref refused');
    assert.equal(created.trace.components.base.components.length, 3);
    assert.match(prompts.at(-1), /BASE COMPONENTS/);
    const trace = { ...created.trace, prompt: 'Add promo codes' };

    const plan = await result(await post('/api/plan', { trace }));
    assert.equal(plan.plan.tasks.length, 1);
    assert.match(prompts.at(-1), /Enter codes/);

    const flow = await result(await post('/api/flow', { trace }));
    assert.equal(flow.type, 'result');
    assert.match(prompts.at(-1), /SAVED COMPONENT PERSPECTIVE/);
    assert.doesNotMatch(prompts.at(-1), /"base"/);

    const redrawn = await result(await post('/api/trace/components', { trace: { ...trace, sitemap: { base: { screens: [{ id: 'sitemap-base-marker' }] }, summary: 'kept' } } }));
    assert.equal(redrawn.type, 'result');
    assert.equal(redrawn.components.applicability, 'relevant');
    assert.match(prompts.at(-1), /^Use read-only search and file tools to add a Components output/);
    assert.doesNotMatch(prompts.at(-1), /sitemap-base-marker/, 'the other output\'s base is stripped');
    assert.doesNotMatch(prompts.at(-1), /TRACE \(data[^\n]*"involved"/, 'the old output is not sent back');
    invalid = true;
    const failed = await result(await post('/api/trace/components', { trace }));
    assert.equal(failed.type, 'error');
    assert.match(failed.message, /no usable Components output/);
    assert.equal((await post('/api/trace/components', { trace, model: '--bad' })).status, 400);
    assert.equal(readFileSync(path.join(root, '.repo-map/components.json'), 'utf8'), before);
});

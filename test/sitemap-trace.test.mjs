import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { normalizeSitemapTrace, composeSitemapTrace } from '../lib/sitemap-trace.mjs';
import { startServer } from '../lib/server.mjs';

const ref = { path: 'src/pages/checkout/CheckoutPage.jsx', start: 1, end: 3, why: 'Checkout screen' };
const base = { version: 1, applicability: 'applicable', summary: 'Shop', applications: [{ id: 'shop', label: 'Shop' }],
    screens: ['cart', 'checkout', 'receipt'].map((id) => ({ id, app: 'shop', label: id, route: '/' + id, detail: id, refs: [ref] })),
    navigation: [
        { from: 'cart', to: 'checkout', label: 'Continue', condition: 'Signed in', refs: [ref] },
        { from: 'cart', to: 'checkout', label: 'Continue', condition: 'Guest', refs: [ref] },
    ], gaps: [] };
const raw = { version: 1, applicability: 'relevant', summary: 'Guest checkout', gaps: [],
    steps: [{ screen: 'cart', note: 'Review cart', refs: [ref] }, { screen: 'checkout', note: 'Enter details' }, { screen: 'cart', note: 'Edit cart' }],
    navigation: [1], changes: { screens: [{ id: 'checkout', status: 'modified', route: '/guest', rationale: 'Allow guests' }],
        navigation: [{ index: 1, status: 'removed', rationale: 'Replace guest navigation' },
            { from: 'cart', to: 'receipt', label: 'Express', status: 'new', rationale: 'Express purchase' }] } };

test('screen traces retain repeated visits, parallel navigation and immutable proposal snapshots', () => {
    const before = structuredClone(base);
    const output = normalizeSitemapTrace(raw, base, 'proposal');
    const composed = composeSitemapTrace(output);
    assert.deepEqual(output.steps.map((s) => s.screen), ['cart', 'checkout', 'cart']);
    assert.deepEqual(output.navigation, [1]);
    assert.equal(composed.screens[1].route, '/guest');
    assert.equal(composed.navigation[0].status, undefined);
    assert.equal(composed.navigation[1].status, 'removed');
    assert.equal(composed.navigation[2].status, 'new');
    assert.deepEqual(base, before);
    assert.deepEqual(normalizeSitemapTrace(JSON.parse(JSON.stringify(output)), null, 'proposal'), output);
    assert.deepEqual(normalizeSitemapTrace(raw, base, 'description').changes, { screens: [], navigation: [] });
});

test('invalid screen and navigation identities cannot become false journey evidence', () => {
    const output = normalizeSitemapTrace({ ...raw, steps: [...raw.steps, { screen: 'unknown', note: 'Invented' }],
        navigation: [-1, 400, 1, 1], changes: { screens: [{ id: 'unknown', status: 'modified' },
            { id: 'proposal-new', app: 'shop', label: 'New screen', status: 'new', refs: [{ path: '../secret', start: 1, end: 1 }] }],
        navigation: [{ index: 88, status: 'removed' }, { from: 'unknown', to: 'cart', status: 'new' }] } }, base, 'proposal');
    assert.equal(output.steps.length, 3);
    assert.deepEqual(output.navigation, [1]);
    assert.equal(output.changes.screens.length, 1);
    assert.deepEqual(output.changes.screens[0].refs, []);
    assert.deepEqual(output.changes.navigation, []);
    assert.ok(output.gaps.length);
    assert.equal(normalizeSitemapTrace({ applicability: 'relevant', steps: [] }, base), null);
    assert.equal(normalizeSitemapTrace({ applicability: 'none', summary: 'Background job only.' }, base).applicability, 'none');
});

test('Sitemap API supports screen-only proposals, retries, planning, and saved snapshots without changing the sitemap', async (t) => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'repo-map-screen-trace-'));
    cpSync(new URL('../examples/shop/', import.meta.url), root, { recursive: true, filter: (source) => !String(source).endsWith('sitemap.json') });
    const prompts = [];
    let invalid = false;
    const fake = createServer((req, res) => {
        let buffer = '';
        req.on('data', (chunk) => { buffer += chunk; });
        req.on('end', () => {
            if (req.method === 'GET') return res.end(JSON.stringify({ data: [{ id: 'fake' }] }));
            const prompt = JSON.parse(buffer).messages.at(-1).content;
            prompts.push(prompt);
            const sitemap = { ...raw, steps: [{ screen: 'cart', note: 'Start', refs: [{ path: '.env', start: 1, end: 2 }, ref] }] };
            const answer = prompt.startsWith('Classify') ? { intent: 'proposal', title: 'Guest checkout' }
                : prompt.startsWith('Create an implementation plan') ? { summary: 'Implement guest checkout', tasks: [{ title: 'Update checkout', detail: 'Allow guest details', files: [] }], interfaces: [], tests: [], risks: [], questions: [] }
                : prompt.startsWith('Use read-only search') ? { sitemap: invalid ? {} : sitemap }
                : { intent: 'proposal', title: 'Guest checkout', summary: 'Guest checkout', steps: [], edges: [], gaps: '', proposal: { nodes: [], edges: [] }, sitemap: invalid ? {} : sitemap };
            res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }));
        });
    });
    await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
    writeFileSync(path.join(root, '.repo-map/local.json'), JSON.stringify({ ai: { provider: 'api', api: { baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model: 'fake' } } }));
    const { server } = await startServer({ root, port: 48000 + Math.floor(Math.random() * 1000), findFreePort: true });
    t.after(() => { server.closeAllConnections(); server.close(); fake.closeAllConnections(); fake.close(); rmSync(root, { recursive: true, force: true }); });
    const url = `http://127.0.0.1:${server.address().port}`;
    const headers = { 'x-map': '1', 'content-type': 'application/json' };
    const post = (endpoint, body) => fetch(url + endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    const result = async (response) => (await response.text()).trim().split('\n').map(JSON.parse).find((e) => ['result', 'error'].includes(e.type));
    assert.equal((await post('/api/trace', { prompt: 'Add guest checkout', sitemap: true })).status, 400);
    assert.equal(prompts.length, 0);
    writeFileSync(path.join(root, '.repo-map/sitemap.json'), JSON.stringify(base));
    const before = readFileSync(path.join(root, '.repo-map/sitemap.json'), 'utf8');
    const created = await result(await post('/api/trace', { prompt: 'Add guest checkout', sitemap: true, architecture: false }));
    assert.equal(created.type, 'result');
    assert.deepEqual(created.trace.steps, []);
    assert.equal(created.trace.sitemap.changes.screens[0].status, 'modified');
    assert.equal(created.trace.sitemap.steps[0].refs.length, 1);
    assert.match(prompts.at(-1), /BASE SITEMAP/);
    const trace = { ...created.trace, prompt: 'Add guest checkout' };
    const plan = await result(await post('/api/plan', { trace }));
    assert.equal(plan.plan.tasks.length, 1);
    assert.match(prompts.at(-1), /Allow guests/);
    const added = await result(await post('/api/trace/sitemap', { trace }));
    assert.equal(added.sitemap.applicability, 'relevant');
    invalid = true;
    assert.equal((await result(await post('/api/trace/sitemap', { trace }))).type, 'error');
    assert.equal((await post('/api/trace/sitemap', { trace, model: '--bad' })).status, 400);
    assert.equal((await fetch(url + '/api/trace/sitemap', { method: 'POST', body: '{}' })).status, 403);
    const { key } = await (await post('/api/traces', trace)).json();
    const saved = (await (await fetch(url + '/api/traces', { headers })).json()).traces.find((t) => t.key === key);
    assert.deepEqual(saved.sitemap, trace.sitemap);
    assert.equal(readFileSync(path.join(root, '.repo-map/sitemap.json'), 'utf8'), before);
});

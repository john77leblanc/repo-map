import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { withDefaults } from '../lib/config.mjs';
import { componentTree, componentUsage, componentsInFiles, normalizeComponents, rootsFor, screensUsing, sharedComponents } from '../lib/components-data.mjs';
import { cleanComponents, componentsStatus, generateComponents, loadComponents } from '../lib/components.mjs';
import { componentsPrompt } from '../lib/prompts.mjs';
import { RESPONSE_SCHEMAS } from '../lib/response-contracts.mjs';
import { startServer } from '../lib/server.mjs';

const EXAMPLE = fileURLToPath(new URL('../examples/shop/', import.meta.url));
const cartRef = { path: 'src/pages/cart/CartPage.jsx', start: 1, end: 12, why: 'Declares CartPage' };
const checkoutRef = { path: 'src/pages/checkout/CheckoutPage.jsx', start: 4, end: 21, why: 'Declares CheckoutPage' };
const sitemap = () => ({ version: 1, applicability: 'applicable', summary: 'Storefront.',
    applications: [{ id: 'shop', label: 'Storefront' }],
    screens: [
        { id: 'cart', app: 'shop', label: 'Cart', route: '/cart', detail: '', refs: [cartRef] },
        { id: 'checkout', app: 'shop', label: 'Checkout', route: '/checkout', detail: '', refs: [checkoutRef] },
    ],
    navigation: [{ from: 'cart', to: 'checkout', label: 'Check out', condition: '', refs: [cartRef] }], gaps: [] });
const fixture = () => ({ version: 1, applicability: 'applicable', summary: 'Two pages sharing a price line.',
    components: [
        { id: 'cart-page', label: 'CartPage', detail: 'Lists items', tags: ['state'], refs: [cartRef] },
        { id: 'checkout-page', label: 'CheckoutPage', detail: 'Order form', tags: ['state', 'fetches', 'form', 'bogus'], card: 'checkout', refs: [checkoutRef] },
        { id: 'summary', label: 'CartSummary', detail: '', tags: [], refs: [cartRef] },
        { id: 'price', label: 'PriceLine', detail: '', tags: [], refs: [cartRef] },
    ],
    uses: [{ from: 'cart-page', to: 'summary' }, { from: 'checkout-page', to: 'summary' }, { from: 'summary', to: 'price' }, { from: 'price', to: 'summary' }],
    screens: [{ screen: 'cart', root: 'cart-page' }, { screen: 'checkout', root: 'checkout-page' }], gaps: [] });
const aiFixture = () => { const raw = fixture(); raw.components[1].tags = ['state', 'fetches', 'form']; return raw; };
const config = (extra = {}) => withDefaults({ codeRoots: ['src/'] }, { env: {}, ...extra });

function shop(t, { withSitemap = true } = {}) {
    const root = mkdtempSync(path.join(os.tmpdir(), 'repo-map-components-'));
    cpSync(EXAMPLE, root, { recursive: true, filter: (source) => !/(sitemap|components)\.json$/.test(source) });
    if (withSitemap) writeFileSync(path.join(root, '.repo-map/sitemap.json'), JSON.stringify(sitemap()));
    const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
    git('init', '-q');
    const commit = () => { git('add', '-A'); git('-c', 'user.name=test', '-c', 'user.email=test@test', 'commit', '-qm', 'fixture'); };
    commit();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    return { root, git, commit };
}

async function fakeAi(t, answer) {
    const calls = [];
    const server = createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', async () => {
            res.setHeader('content-type', 'application/json');
            if (req.method === 'GET') return res.end(JSON.stringify({ data: [{ id: 'fake' }] }));
            calls.push(JSON.parse(body));
            const result = await answer();
            res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(result) } }] }));
        });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    return { calls, url: `http://127.0.0.1:${server.address().port}/v1` };
}

test('component normalization keeps known tags, drops bad links and stale screens', () => {
    const data = normalizeComponents(fixture());
    assert.deepEqual(data.components[1].tags, ['state', 'fetches', 'form']);
    assert.equal(data.components[1].card, 'checkout');
    assert.equal(data.applicability, 'applicable');
    assert.equal(normalizeComponents({ ...fixture(), version: 2 }), null);
    assert.equal(normalizeComponents({ ...fixture(), components: [] }), null);
    assert.equal(normalizeComponents({ ...fixture(), applicability: 'none' }), null);
    const raw = fixture();
    raw.uses.push({ from: 'price', to: 'price' }, { from: 'missing', to: 'price' }, { from: 'cart-page', to: 'summary' });
    assert.equal(normalizeComponents(raw).uses.length, 4);
    assert.equal(normalizeComponents(raw).applicability, 'incomplete');
    const stale = normalizeComponents(fixture(), new Set(['cart']));
    assert.deepEqual(stale.screens, [{ screen: 'cart', root: 'cart-page' }]);
    assert.match(stale.gaps.join(' '), /no longer in the sitemap/);
    const none = normalizeComponents({ version: 1, applicability: 'none', summary: 'No UI.', components: [], uses: [], screens: [], gaps: [] });
    assert.equal(none.applicability, 'none');
});

test('component trees are depth-capped and cycle-safe; usage finds shared components', () => {
    const data = normalizeComponents(fixture());
    const tree = componentTree(data, 'cart-page');
    assert.equal(tree.component.label, 'CartPage');
    const summary = tree.children[0];
    assert.equal(summary.id, 'summary');
    assert.equal(summary.children[0].id, 'price');
    assert.equal(summary.children[0].children[0].repeat, true);
    const shallow = componentTree(data, 'cart-page', 2);
    assert.equal(shallow.children[0].children.length, 0);
    assert.equal(shallow.children[0].more, 1);
    assert.equal(componentTree(data, 'missing'), null);
    assert.deepEqual(screensUsing(data, 'price'), ['cart', 'checkout']);
    assert.deepEqual(screensUsing(data, 'cart-page'), ['cart']);
    assert.deepEqual(componentUsage(data).get('summary'), ['cart', 'checkout']);
    assert.deepEqual(sharedComponents(data).map((c) => c.id), ['summary', 'price']);
    assert.deepEqual(rootsFor(data, 'checkout'), ['checkout-page']);
    assert.deepEqual(componentsInFiles(data, ['src\\pages\\checkout\\CheckoutPage.jsx']), ['checkout-page']);
});

test('component evidence drops blocked or invented refs along with their links', async () => {
    const raw = fixture();
    raw.components[2].refs = [{ path: '.env', start: 1, end: 1 }];
    raw.components[3].refs = [{ ...cartRef, end: 100000 }];
    const result = await cleanComponents(EXAMPLE, config(), raw, sitemap());
    assert.equal(result.applicability, 'incomplete');
    assert.deepEqual(result.components.map((c) => c.id), ['cart-page', 'checkout-page']);
    assert.equal(result.uses.length, 0);
    assert.equal(result.screens.length, 2);
    assert.match(result.gaps.join(' '), /without valid code evidence/);
});

test('components prompt anchors to sitemap screens and cards; schema accepts the fixture shape', () => {
    const prompt = componentsPrompt(config({ }), sitemap(), { nodes: [{ id: 'checkout', title: 'Checkout', path: 'src/pages/checkout' }] });
    assert.match(prompt, /"id":"checkout"/);
    assert.match(prompt, /Imports alone do not prove rendering/);
    assert.ok(RESPONSE_SCHEMAS.components.properties.components);
});

test('component generation needs a sitemap, persists, tracks freshness and keeps the old file on failure', async (t) => {
    const missing = shop(t, { withSitemap: false });
    const ai = await fakeAi(t, () => answer);
    let answer = aiFixture();
    const cfg = config({ localAi: { provider: 'none', generate: { provider: 'api', model: 'fake' }, api: { baseUrl: ai.url, model: 'baseline' } } });
    await assert.rejects(generateComponents({ root: missing.root, config: cfg }), { code: 'sitemap' });
    const { root, git, commit } = shop(t);
    assert.equal(await loadComponents(root, cfg), null);
    assert.equal((await componentsStatus(root, cfg, null)).state, 'missing');
    const result = await generateComponents({ root, config: cfg });
    assert.equal(result.components.commit, git('rev-parse', 'HEAD'));
    assert.equal(result.status.state, 'current');
    // "checkout" is not a card in the example map, so it is dropped
    assert.equal(result.components.components[1].card, undefined);
    assert.deepEqual(await loadComponents(root, cfg), result.components);
    assert.equal(ai.calls[0].model, 'fake');
    const saved = readFileSync(path.join(root, '.repo-map/components.json'), 'utf8');
    answer = { nonsense: true };
    await assert.rejects(generateComponents({ root, config: cfg }), { code: 'schema' });
    answer = aiFixture();
    answer.components.forEach((c) => { c.refs = []; });
    await assert.rejects(generateComponents({ root, config: cfg }), /valid code evidence/);
    assert.equal(readFileSync(path.join(root, '.repo-map/components.json'), 'utf8'), saved);
    writeFileSync(path.join(root, 'src/Extra.jsx'), '// ui\n');
    commit();
    assert.equal((await componentsStatus(root, cfg, result.components)).state, 'stale');
    // the sitemap dropped a screen: its link disappears on load
    const smaller = sitemap();
    smaller.screens.pop();
    smaller.navigation = [];
    writeFileSync(path.join(root, '.repo-map/sitemap.json'), JSON.stringify(smaller));
    assert.deepEqual((await loadComponents(root, cfg)).screens.map((s) => s.screen), ['cart']);
});

test('component routes serve the saved map and share the sitemap lock', async (t) => {
    const { root } = shop(t);
    const ai = await fakeAi(t, () => new Promise((resolve) => setTimeout(() => resolve(aiFixture()), 200)));
    writeFileSync(path.join(root, '.repo-map/local.json'), JSON.stringify({ ai: { provider: 'api', api: { baseUrl: ai.url, model: 'fake' } } }));
    const { server, port } = await startServer({ root, port: 49000 + Math.floor(Math.random() * 1000), findFreePort: true });
    t.after(() => { server.closeAllConnections?.(); server.close(); });
    const base = `http://127.0.0.1:${port}`;
    const headers = { 'x-map': '1' };
    const empty = await (await fetch(`${base}/api/components`, { headers })).json();
    assert.equal(empty.components, null);
    assert.equal(empty.status.state, 'missing');
    const job = fetch(`${base}/api/components/generate`, { method: 'POST', headers });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const busy = await fetch(`${base}/api/sitemap/generate`, { method: 'POST', headers });
    assert.equal(busy.status, 409);
    assert.match((await busy.json()).error, /Component mapping/);
    const lines = (await (await job).text()).trim().split('\n').map((line) => JSON.parse(line));
    const result = lines.find((line) => line.type === 'result');
    assert.ok(result, JSON.stringify(lines));
    assert.equal(result.job, 'components');
    assert.equal(result.components.components.length, 4);
    assert.ok(existsSync(path.join(root, '.repo-map/components.json')));
    const saved = await (await fetch(`${base}/api/components`, { headers })).json();
    assert.equal(saved.status.state, 'current');
});

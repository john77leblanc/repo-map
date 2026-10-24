import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { withDefaults } from '../lib/config.mjs';
import { normalizeSitemap } from '../lib/sitemap-data.mjs';
import { cleanSitemap, generateSitemap, loadSitemap, sitemapStatus } from '../lib/sitemap.mjs';
import { sitemapPrompt } from '../lib/prompts.mjs';
import { startServer } from '../lib/server.mjs';

const EXAMPLE = fileURLToPath(new URL('../examples/shop/', import.meta.url));
const reference = { path: 'src/pages/checkout/CheckoutPage.jsx', start: 1, end: 3, why: 'Screen and navigation evidence' };
const fixture = () => ({ version: 1, applicability: 'applicable', summary: 'Storefront and administration screens.',
    applications: [{ id: 'shop', label: 'Storefront' }, { id: 'admin', label: 'Admin' }],
    screens: [
        { id: 'checkout', app: 'shop', label: 'Checkout', route: '/checkout/:cart', detail: 'Checkout with payment dialog.', refs: [reference] },
        { id: 'settings', app: 'shop', label: 'Settings workspace', route: '', detail: 'A workspace without its own URL.', refs: [reference] },
        { id: 'admin', app: 'admin', label: 'Administration', route: '/admin', detail: '', refs: [reference] },
    ],
    navigation: [{ from: 'checkout', to: 'settings', label: 'Settings', condition: 'Signed in', refs: [reference] },
        { from: 'settings', to: 'admin', label: 'Open administration', condition: 'Administrator', refs: [reference] }], gaps: [] });
const config = (extra = {}) => withDefaults({ codeRoots: ['src/'] }, { env: {}, ...extra });

function shop(t) {
    const root = mkdtempSync(path.join(os.tmpdir(), 'repo-map-sitemap-'));
    cpSync(EXAMPLE, root, { recursive: true, filter: (source) => !source.endsWith('sitemap.json') });
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

test('sitemap normalization preserves screens, route patterns, conditions and monorepo grouping', () => {
    const sitemap = normalizeSitemap(fixture());
    assert.deepEqual(sitemap.applications.map((app) => app.label), ['Admin', 'Storefront']);
    assert.equal(sitemap.screens[0].route, '/checkout/:cart');
    assert.equal(sitemap.screens[1].route, '');
    assert.equal(sitemap.navigation[0].condition, 'Signed in');
    assert.equal(normalizeSitemap({ ...fixture(), version: 99 }), null);
    assert.equal(normalizeSitemap({ ...fixture(), screens: [] }), null);
    const raw = fixture();
    raw.navigation.push({ from: 'missing', to: 'checkout' });
    assert.equal(normalizeSitemap(raw).applicability, 'incomplete');
    assert.equal(normalizeSitemap(raw).navigation.length, 2);
    for (const applicability of ['none', 'incomplete']) {
        const empty = normalizeSitemap({ version: 1, applicability, summary: 'No screens identified.', applications: [], screens: [], navigation: [], gaps: [] });
        assert.equal(empty.applicability, applicability);
    }
});

test('sitemap evidence rejects blocked files, missing evidence, and invented line ranges', async () => {
    const raw = fixture();
    raw.screens[1].refs = [{ path: '.env', start: 1, end: 1 }];
    raw.navigation[1].refs = [{ ...reference, end: 100000 }];
    const result = await cleanSitemap(EXAMPLE, config(), raw);
    assert.equal(result.applicability, 'incomplete');
    assert.equal(result.screens.length, 2);
    assert.equal(result.navigation.length, 0);
    assert.ok(result.gaps.length);
    for (const blocked of ['../README.md', '.repo-map/config.json', 'src/.env', 'node_modules/file.js', 'README.md']) {
        const candidate = fixture();
        candidate.screens[0].refs = [{ path: blocked, start: 1, end: 1 }];
        assert.ok(!(await cleanSitemap(EXAMPLE, config(), candidate)).screens.some((screen) => screen.id === 'checkout'), blocked);
    }
});

test('sitemap generation uses generate settings, persists independently, and tracks freshness', async (t) => {
    const { root, git, commit } = shop(t);
    let answer = fixture();
    const ai = await fakeAi(t, () => answer);
    const cfg = config({ localAi: { provider: 'none', generate: { provider: 'api', model: 'fake' }, api: { baseUrl: ai.url, model: 'baseline' } } });
    assert.equal(await loadSitemap(root, cfg), null);
    assert.equal((await sitemapStatus(root, cfg, null)).state, 'missing');
    const mapBefore = readFileSync(path.join(root, '.repo-map/map.json'), 'utf8');
    const result = await generateSitemap({ root, config: cfg });
    assert.equal(result.sitemap.commit, git('rev-parse', 'HEAD'));
    assert.equal(result.status.state, 'current');
    assert.deepEqual(await loadSitemap(root, cfg), result.sitemap);
    assert.equal(ai.calls[0].model, 'fake');
    assert.match(ai.calls[0].messages.find((message) => message.role === 'user').content, /URL nesting does NOT prove navigation/);
    assert.equal(readFileSync(path.join(root, '.repo-map/map.json'), 'utf8'), mapBefore);
    const saved = readFileSync(path.join(root, '.repo-map/sitemap.json'), 'utf8');
    answer = { nonsense: true };
    await assert.rejects(generateSitemap({ root, config: cfg }), { code: 'schema' });
    assert.equal(readFileSync(path.join(root, '.repo-map/sitemap.json'), 'utf8'), saved);
    answer = fixture();
    answer.screens.forEach((screen) => { screen.refs = []; });
    await assert.rejects(generateSitemap({ root, config: cfg }), /valid code evidence/);
    assert.equal(readFileSync(path.join(root, '.repo-map/sitemap.json'), 'utf8'), saved);
    writeFileSync(path.join(root, 'src/new-screen.js'), '// screen\n');
    assert.equal((await sitemapStatus(root, cfg, result.sitemap)).dirty, true);
    commit();
    assert.equal((await sitemapStatus(root, cfg, result.sitemap)).state, 'stale');
    answer = { ...fixture(), applicability: 'none', summary: 'Backend only.', applications: [], screens: [], navigation: [] };
    const negative = await generateSitemap({ root, config: cfg });
    assert.equal(negative.sitemap.applicability, 'none');
    assert.equal(negative.status.state, 'current');
});

test('sitemap cancellation preserves the saved result', async (t) => {
    const { root } = shop(t);
    const ai = await fakeAi(t, () => fixture());
    const cfg = config({ localAi: { provider: 'api', api: { baseUrl: ai.url, model: 'fake' } } });
    await generateSitemap({ root, config: cfg });
    const saved = readFileSync(path.join(root, '.repo-map/sitemap.json'), 'utf8');
    await assert.rejects(generateSitemap({ root, config: cfg, onStart: (run) => run.kill() }));
    assert.equal(readFileSync(path.join(root, '.repo-map/sitemap.json'), 'utf8'), saved);
});

test('committing sitemap metadata alone does not make a root-wide sitemap stale', async (t) => {
    const { root, git, commit } = shop(t);
    const cfg = withDefaults({ codeRoots: ['./'] }, { env: {} });
    const sitemap = { ...normalizeSitemap(fixture()), commit: git('rev-parse', 'HEAD') };
    writeFileSync(path.join(root, '.repo-map/sitemap.json'), JSON.stringify(sitemap));
    assert.equal((await sitemapStatus(root, cfg, sitemap)).dirty, false);
    commit();
    assert.equal((await sitemapStatus(root, cfg, sitemap)).state, 'current');
    writeFileSync(path.join(root, 'src/new-screen.js'), '// new screen\n');
    assert.equal((await sitemapStatus(root, cfg, sitemap)).dirty, true);
    commit();
    assert.equal((await sitemapStatus(root, cfg, sitemap)).state, 'stale');
});

test('sitemap API guards access, streams generation, and runs beside a map job with its own lock', async (t) => {
    const { root } = shop(t);
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    let started;
    const entered = new Promise((resolve) => { started = resolve; });
    const ai = await fakeAi(t, async () => { started(); await held; return fixture(); });
    writeFileSync(path.join(root, '.repo-map/local.json'), JSON.stringify({ provider: 'api', api: { baseUrl: ai.url, model: 'fake' } }));
    const { server } = await startServer({ root, port: 49000 + Math.floor(Math.random() * 1000), findFreePort: true });
    t.after(() => { release(); server.closeAllConnections(); server.close(); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { 'x-map': '1' };
    assert.equal((await fetch(`${base}/api/sitemap`)).status, 403);
    assert.equal((await (await fetch(`${base}/api/sitemap`, { headers })).json()).sitemap, null);
    const pending = fetch(`${base}/api/sitemap/generate`, { method: 'POST', headers });
    await entered;
    // the map has its own lock, so a map job starts while the sitemap runs
    const mapCtl = new AbortController();
    const mapJob = await fetch(`${base}/api/map/generate`, { method: 'POST', headers, signal: mapCtl.signal });
    assert.equal(mapJob.status, 200);
    const status = await (await fetch(`${base}/api/map/status`, { headers })).json();
    assert.equal(status.job, 'generate');
    assert.equal(status.sitemapJob, 'sitemap');
    // ...but each lock still allows one job at a time
    assert.equal((await fetch(`${base}/api/docs/link`, { method: 'POST', headers })).status, 409);
    const again = await fetch(`${base}/api/sitemap/generate`, { method: 'POST', headers });
    assert.equal(again.status, 409);
    mapCtl.abort();
    await mapJob.text().catch(() => {});
    release();
    const events = (await (await pending).text()).trim().split('\n').map((line) => JSON.parse(line));
    assert.ok(events.some((event) => event.type === 'progress'));
    assert.equal(events.find((event) => event.type === 'result').sitemap.screens.length, 3);
    const saved = await (await fetch(`${base}/api/sitemap`, { headers })).json();
    assert.equal(saved.sitemap.screens.length, 3);
    assert.equal((await (await fetch(`${base}/api/map/status`, { headers })).json()).job, null);
});

test('sitemap prompt carries guidance and distinguishes incomplete analysis from no UI', () => {
    const prompt = sitemapPrompt(config(), { guidance: { text: 'Use the application router.', files: [] } });
    assert.match(prompt, /Use the application router/);
    assert.match(prompt, /incomplete/);
    assert.match(prompt, /screens without URLs/);
    assert.match(prompt, /never change files/);
});

test('starter map endpoint writes a folder map only when there is no map yet', async (t) => {
    const { root } = shop(t);
    const { server } = await startServer({ root, port: 49000 + Math.floor(Math.random() * 1000), findFreePort: true });
    t.after(() => { server.closeAllConnections(); server.close(); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = () => fetch(`${base}/api/map/starter`, { method: 'POST', headers: { 'x-map': '1' } });
    assert.equal((await post()).status, 409, 'the example already has a map');
    rmSync(path.join(root, '.repo-map', 'map.json'));
    const res = await post();
    assert.equal(res.status, 200);
    assert.ok((await res.json()).nodes > 0);
    const map = JSON.parse(readFileSync(path.join(root, '.repo-map', 'map.json'), 'utf8'));
    assert.equal(map.starter, true);
    assert.equal((await post()).status, 409);
});

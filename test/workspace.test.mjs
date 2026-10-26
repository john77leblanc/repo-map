import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadConfig, loadMap } from '../lib/config.mjs';
import { proposedSeams } from '../lib/seams.mjs';
import { startServer } from '../lib/server.mjs';
import { checkSnapshot, exportSnapshot, importSnapshot, loadWorkspace, publicRemote, readWorkspaceLines, remoteStatus, workspaceView } from '../lib/workspace.mjs';
import { collapseRepos, mergeMaps, normalizeWorkspace, repoOf } from '../lib/workspace-map.mjs';

const EXAMPLES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const SHOP = path.join(EXAMPLES, 'shop');
const API = path.join(EXAMPLES, 'shop-api');

/** A temp folder holding copies of both example repos, side by side. */
function copyExamples(t) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'repo-map-ws-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    cpSync(SHOP, path.join(dir, 'shop'), { recursive: true, filter: (src) => !src.includes(`${path.sep}traces`) });
    cpSync(API, path.join(dir, 'shop-api'), { recursive: true });
    return { dir, shop: path.join(dir, 'shop'), api: path.join(dir, 'shop-api') };
}

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

test('normalizeWorkspace keeps valid links and seams only', () => {
    const ws = normalizeWorkspace({
        links: [{ name: 'api', dir: '../api' }, { name: 'api', dir: '../dup' }, { name: 'home', dir: '../x' }, { name: 'Bad', dir: '../x' },
            { name: 'c', dir: '../x' }, { name: 'snap', snapshot: 'links/snap.map.json' }, { name: 'evil', snapshot: '../../etc/passwd' }, { name: 'none' }],
        seams: [{ from: 'a', to: 'api:b', type: 'http', via: 'contract', refs: [{ path: 'x', start: 5, end: 2 }] }, { from: 'a', to: 'api:b' }, { from: 'a', to: 'a' }],
        extra: true,
    });
    assert.deepEqual(ws.links, [{ name: 'api', dir: '../api' }, { name: 'snap', snapshot: 'links/snap.map.json' }]);
    assert.deepEqual(ws.seams, [{ from: 'a', to: 'api:b', type: 'http', via: 'ai', refs: [{ path: 'x', start: 5, end: 5 }] }]);
    assert.deepEqual(Object.keys(ws), ['links', 'seams']);
});

test('mergeMaps prefixes linked ids, joins seams by contract and replaces placeholder cards', async () => {
    const home = await loadMap(SHOP);
    const api = await loadMap(API);
    const before = JSON.stringify([home, api]);
    const merged = mergeMaps(home, [{ name: 'api', title: 'Shop API', map: api }], { columns: 5, homeTitle: 'Shop' });
    assert.equal(JSON.stringify([home, api]), before, 'inputs unchanged');
    const ids = merged.nodes.map((n) => n.id);
    assert.ok(ids.includes('api:orders-route') && ids.includes('orders-client'));
    // "Orders API" in the shop and "Storefront" in the API stood for each other's real cards
    assert.deepEqual(merged.replaced, { 'orders-api': 'api:orders-route', 'api:storefront': 'orders-client' });
    assert.ok(!ids.includes('orders-api') && !ids.includes('api:storefront'));
    assert.ok(ids.includes('payments-api'), 'an unexplained placeholder stays');
    const seam = merged.edges.filter((e) => e.seam);
    assert.deepEqual(seam, [{ from: 'orders-client', to: 'api:orders-route', type: 'http', label: 'POST /orders', seam: 'contract', keys: ['http:POST /orders'] }]);
    assert.ok(!merged.edges.some((e) => e.to === 'orders-api' || e.from === 'api:storefront'));
    assert.ok(!merged.groups.some((g) => g.id === 'api:g-callers'), 'groups left empty are dropped');
    assert.equal(merged.groups.find((g) => g.id === 'api:g-routes').repo, 'api');
    assert.deepEqual(merged.repos.map((r) => [r.name, r.count]), [['home', 8], ['api', 6]]);
    // the event contract inside the API isn't a seam
    assert.equal(merged.seams.length, 1);
    assert.equal(repoOf('api:queue', new Set(['api'])), 'api');
    assert.equal(repoOf('orders-client', new Set(['api'])), 'home');
});

test('mergeMaps adds stored seams between repos and ignores ones inside a repo or to unknown cards', async () => {
    const merged = mergeMaps(await loadMap(SHOP), [{ name: 'api', map: await loadMap(API) }], { seams: [
        { from: 'payments-client', to: 'api:orders-route', type: 'http', label: 'GET /orders/{id}', via: 'manual' },
        { from: 'cart-page', to: 'checkout-page', via: 'ai' },
        { from: 'cart-page', to: 'api:nope' },
        { from: 'orders-client', to: 'api:orders-route', via: 'ai', why: 'checked by hand', refs: [{ path: 'src/api/orders.js', start: 8, end: 12 }] },
    ] });
    const seams = merged.edges.filter((e) => e.seam);
    assert.deepEqual(seams.map((e) => `${e.from}>${e.to}:${e.seam}`), ['orders-client>api:orders-route:ai', 'payments-client>api:orders-route:manual']);
    assert.equal(seams[0].why, 'checked by hand');
    assert.deepEqual(seams[0].keys, ['http:POST /orders'], 'contract keys kept when a stored seam matches');
});

test('collapseRepos folds a repo into one card that seam edges attach to', async () => {
    const merged = mergeMaps(await loadMap(SHOP), [{ name: 'api', map: await loadMap(API) }], { columns: 5 });
    const out = collapseRepos(merged, ['repo:api'], { api: 'Shop API' });
    const card = out.nodes.find((n) => n.id === 'c:repo:api');
    assert.equal(card.title, 'Shop API');
    assert.equal(card.group, 'repo:api');
    assert.equal(card.members.length, 5);
    assert.ok(!out.nodes.some((n) => n.repo === 'api' && !n.collapsed));
    assert.deepEqual(out.groups.find((g) => g.id === 'repo:api'), { id: 'repo:api', col: 2, title: 'Shop API', open: true, repo: 'api' });
    assert.ok(!out.groups.some((g) => g.id.startsWith('api:')));
    const seam = out.edges.find((e) => e.seam);
    assert.equal(seam.from, 'orders-client');
    assert.equal(seam.to, 'c:repo:api');
    assert.equal(collapseRepos(merged, ['repo:nope', 'junk']), merged);
});

test('workspaceView loads the linked example and reports freshness for each repo', async () => {
    const view = await workspaceView(SHOP);
    assert.deepEqual(view.repos.map((r) => [r.name, r.title, r.source, r.readable]), [['home', 'Shop Map', 'home', true], ['api', 'Shop API', 'dir', true]]);
    assert.equal(view.repos[1].freshness.map.state, 'unrecorded');
    assert.ok(view.repos[1].freshness.remote.state);
    assert.equal(view.map.seams.length, 1);
});

test('a broken link reports why instead of failing the workspace', async (t) => {
    const { shop } = copyExamples(t);
    writeFileSync(path.join(shop, '.repo-map', 'workspace.json'), JSON.stringify({ links: [{ name: 'gone', dir: '../missing' }, { name: 'self', dir: '.' }] }));
    const view = await workspaceView(shop);
    assert.match(view.repos[1].error, /No \.repo-map\/config\.json/);
    assert.match(view.repos[2].error, /points at this repo/);
    assert.equal(view.map.repos.length, 1);
});

test('linked files are readable through a name prefix, with the same exclusions', async (t) => {
    const { shop, api } = copyExamples(t);
    writeFileSync(path.join(api, '.env'), 'SECRET=1');
    const config = await loadConfig(shop);
    const read = await readWorkspaceLines(shop, config, 'api:src/routes/orders.js');
    assert.equal(read.clean, 'api:src/routes/orders.js');
    assert.match(read.lines.join('\n'), /createOrder/);
    for (const bad of ['api:.env', 'api:.repo-map/config.json', 'api:../shop/src/api/orders.js', 'api:README.md/../.env', 'nope:src/x.js']) {
        await assert.rejects(readWorkspaceLines(shop, config, bad), (err) => err.status === 400 || err.status === 404, bad);
    }
    assert.match((await readWorkspaceLines(shop, config, 'src/api/orders.js')).lines.join('\n'), /placeOrder/);
});

test('remoteStatus counts commits ahead of and behind origin/main without fetching', async (t) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'repo-map-remote-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const origin = path.join(dir, 'origin.git');
    const work = path.join(dir, 'work');
    const other = path.join(dir, 'other');
    execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', origin]);
    execFileSync('git', ['clone', '--quiet', origin, work], { stdio: 'ignore' });
    const commit = (cwd, msg) => git(cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--quiet', '--allow-empty', '-m', msg);
    git(work, 'checkout', '--quiet', '-B', 'main');
    commit(work, 'one');
    git(work, 'push', '--quiet', 'origin', 'main');
    execFileSync('git', ['clone', '--quiet', origin, other], { stdio: 'ignore' });
    commit(other, 'two');
    commit(other, 'three');
    git(other, 'push', '--quiet', 'origin', 'main');
    commit(work, 'local');
    const config = { defaultBranch: 'main' };
    let st = await remoteStatus(work, config);
    assert.deepEqual([st.state, st.branch, st.ahead, st.behind], ['current', 'origin/main', 1, 0], 'nothing fetched yet');
    git(work, 'fetch', '--quiet', 'origin');
    st = await remoteStatus(work, config);
    assert.deepEqual([st.state, st.ahead, st.behind], ['behind', 1, 2]);
    assert.ok(st.fetchedAt);
    assert.equal((await remoteStatus(dir, config)).state, 'nogit');
});

test('snapshots export without credentials, import into links/, and reject junk', async (t) => {
    const { shop, api } = copyExamples(t);
    const snap = await exportSnapshot(api);
    assert.equal(snap.format, 'repo-map-snapshot');
    assert.equal(snap.map.nodes.length, 6);
    assert.equal(publicRemote('https://me:tok@github.com/o/r.git'), 'https://github.com/o/r.git');
    assert.throws(() => checkSnapshot({ map: {} }), /isn’t a repo-map snapshot/);
    await assert.rejects(importSnapshot(shop, 'Bad Name', snap), /Link names/);
    writeFileSync(path.join(shop, '.repo-map', 'workspace.json'), '{}');
    await importSnapshot(shop, 'orders', { ...snap, remote: 'https://u:p@example.com/x.git' });
    const saved = JSON.parse(readFileSync(path.join(shop, '.repo-map', 'links', 'orders.map.json'), 'utf8'));
    assert.equal(saved.remote, 'https://example.com/x.git');
    assert.deepEqual((await loadWorkspace(shop)).links, [{ name: 'orders', snapshot: 'links/orders.map.json' }]);
    const view = await workspaceView(shop);
    assert.deepEqual(view.repos[1].freshness, { snapshot: { state: 'unchecked', exportedAt: snap.exportedAt, commit: snap.commit || null } });
    assert.equal(view.repos[1].readable, false);
    assert.ok(view.map.nodes.some((n) => n.id === 'orders:orders-route'));
    await assert.rejects(readWorkspaceLines(shop, await loadConfig(shop), 'orders:src/routes/orders.js'), (err) => err.status === 400);
});

test('proposedSeams keeps new connections between two repos only', async () => {
    const merged = mergeMaps(await loadMap(SHOP), [{ name: 'api', map: await loadMap(API) }]);
    const out = proposedSeams([
        { from: 'payments-client', to: 'api:orders-route', type: 'http', label: 'x', why: 'w', refs: [] },
        { from: 'payments-client', to: 'api:orders-route', type: 'http', why: 'dup', refs: [] },
        { from: 'orders-client', to: 'api:orders-route', type: 'http', why: 'already found', refs: [] },
        { from: 'cart-page', to: 'checkout-page', type: 'sync', why: 'same repo', refs: [] },
        { from: 'cart-page', to: 'api:ghost', type: 'http', why: 'unknown', refs: [] },
    ], merged);
    assert.deepEqual(out, [{ from: 'payments-client', to: 'api:orders-route', type: 'http', via: 'ai', label: 'x', why: 'w' }]);
});

test('workspace API: view, edit, read linked files and find seams with an AI tool', async (t) => {
    const { shop } = copyExamples(t);
    const fake = createServer((req, res) => {
        let b = '';
        req.on('data', (c) => (b += c));
        req.on('end', () => {
            if (req.method === 'GET') return res.end(JSON.stringify({ data: [{ id: 'fake' }] }));
            const seams = [
                { from: 'payments-client', to: 'api:orders-route', type: 'http', label: 'GET /orders/{id}', why: 'looks it up',
                    refs: [{ path: 'api:src/routes/orders.js', start: 20, end: 24, why: 'the route' }, { path: 'api:.env', start: 1, end: 1 }] },
                { from: 'cart-page', to: 'api:queue', type: 'event', why: 'no evidence', refs: [{ path: 'api:src/missing.js', start: 1, end: 2 }] },
            ];
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify({ seams }) }, finish_reason: 'stop' }] }));
        });
    });
    await new Promise((r) => fake.listen(0, '127.0.0.1', r));
    writeFileSync(path.join(shop, '.repo-map', 'local.json'), JSON.stringify({ ai: { provider: 'api', api: { baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model: 'fake' } } }));
    const { server, port } = await startServer({ root: shop, port: 49000 + Math.floor(Math.random() * 500), findFreePort: true });
    t.after(() => {
        server.close();
        fake.close();
    });
    const base = `http://127.0.0.1:${port}`;
    const H = { 'x-map': '1', 'content-type': 'application/json' };
    const view = await (await fetch(`${base}/api/workspace`, { headers: H })).json();
    assert.equal(view.repos.length, 2);
    assert.ok(view.map.edges.some((e) => e.seam === 'contract'));

    const file = await (await fetch(`${base}/api/file?path=${encodeURIComponent('api:src/routes/orders.js')}&start=1&end=3`, { headers: H })).json();
    assert.equal(file.lines.length, 3);
    assert.equal((await fetch(`${base}/api/file?path=${encodeURIComponent('api:.repo-map/map.json')}`, { headers: H })).status, 400);

    const events = (await (await fetch(`${base}/api/workspace/seams`, { method: 'POST', headers: H, body: '{}' })).text()).trim().split('\n').map((l) => JSON.parse(l));
    const result = events.find((e) => e.type === 'result');
    assert.ok(result, JSON.stringify(events.at(-1)));
    assert.deepEqual(result.proposals, [{ from: 'payments-client', to: 'api:orders-route', type: 'http', via: 'ai', label: 'GET /orders/{id}', why: 'looks it up',
        refs: [{ path: 'api:src/routes/orders.js', start: 20, end: 24, why: 'the route' }] }]);

    const put = await fetch(`${base}/api/workspace`, { method: 'PUT', headers: H, body: JSON.stringify({ seams: result.proposals }) });
    const after = await put.json();
    assert.equal(after.workspace.links.length, 1, 'links kept when left out');
    assert.ok(after.map.edges.some((e) => e.seam === 'ai' && e.from === 'payments-client'));
    assert.equal((await fetch(`${base}/api/workspace`, { method: 'PUT', headers: H, body: '{"links":"x"}' })).status, 400);
    assert.equal((await fetch(`${base}/api/workspace/fetch`, { method: 'POST', headers: H, body: '{"name":"nope"}' })).status, 404);
});

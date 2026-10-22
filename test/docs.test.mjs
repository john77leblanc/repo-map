import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { withDefaults } from '../lib/config.mjs';
import { cleanLinks, docsStatus, linkDocs, loadDocs, pruneDocs } from '../lib/docs.mjs';
import { readGuidance } from '../lib/guidance.mjs';
import { docsPrompt } from '../lib/prompts.mjs';
import { findDocFiles, globToRegExp, isDocPath, readablePath } from '../lib/repo.mjs';
import { startServer } from '../lib/server.mjs';

const EXAMPLE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'shop');
const AGENTS = '# AGENTS.md\n\n## Checkout\n\nThe checkout page calls placeOrder().\nCards are charged first.\n\n## Cart\n\nThe cart store is the source of truth.\n';

/** A git copy of the example shop with agent guidance and a docs folder. */
function shop() {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'repo-map-docs-'));
    cpSync(EXAMPLE, dir, { recursive: true });
    rmSync(path.join(dir, '.repo-map', 'traces'), { recursive: true, force: true });
    writeFileSync(path.join(dir, 'AGENTS.md'), AGENTS);
    writeFileSync(path.join(dir, 'CLAUDE.md'), '# CLAUDE.md\n\n@AGENTS.md\n\nClaude-only note.\n');
    cpSync(path.join(dir, 'README.md'), path.join(dir, 'CHANGELOG.md'));
    writeFileSync(path.join(dir, '.env'), 'SECRET=1\n');
    const g = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim();
    g('init', '-q');
    g('add', '-A');
    g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
    return { dir, g, commit: (msg) => { g('add', '-A'); g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', msg); } };
}

const config = (raw = {}) => withDefaults({ codeRoots: ['src/'], ...raw }, {});
const MAP = {
    groups: [{ id: 'g', col: 1, title: 'App' }],
    nodes: [
        { id: 'checkout-page', group: 'g', kind: 'service', path: 'src/pages/checkout' },
        { id: 'cart-store', group: 'g', kind: 'topic', path: 'src/stores' },
        { id: 'payments', group: 'g', kind: 'external', path: '' },
    ],
    edges: [],
};

test('docs are readable outside codeRoots; secrets, blocked folders and .repo-map never are', () => {
    const cfg = config();
    assert.ok(globToRegExp('**/*.md').test('docs/adr/001.md'));
    assert.ok(globToRegExp('*.md').test('README.md'));
    assert.equal(globToRegExp('docs/*.md').test('docs/a/b.md'), false);
    assert.ok(isDocPath(cfg, 'README.md'));
    assert.ok(isDocPath(cfg, '.cursorrules'), 'agent guidance is always a document');
    assert.equal(isDocPath(cfg, 'CHANGELOG.md'), false, 'excluded by default');
    const root = EXAMPLE;
    assert.ok(readablePath(root, cfg, 'README.md'));
    assert.ok(readablePath(root, cfg, 'src/api/orders.js'));
    for (const bad of ['.env', 'src/.env.local', '.repo-map/config.json', 'node_modules/x/README.md', '../README.md', 'scripts/run.js']) {
        assert.equal(readablePath(root, cfg, bad), null, bad);
    }
});

test('finds the repo’s documents and reads agent guidance, following @imports once', async () => {
    const { dir } = shop();
    const files = await findDocFiles(dir, config());
    assert.deepEqual(files.sort(), ['AGENTS.md', 'CLAUDE.md', 'README.md']);
    const g = await readGuidance(dir);
    assert.deepEqual(g.files.map((f) => f.path), ['AGENTS.md', 'CLAUDE.md']);
    assert.equal(g.text.split('The checkout page calls placeOrder()').length, 2, 'AGENTS.md included once');
    assert.match(g.text, /Claude-only note/);
    assert.doesNotMatch(g.files[1].text, /@AGENTS\.md/);
});

test('cleanLinks keeps real sections of known cards, guidance first, comments only from the card’s folder', async () => {
    const { dir } = shop();
    const cfg = config();
    const links = await cleanLinks(dir, cfg, MAP, [
        { node: 'checkout-page', path: 'README.md', start: 1, end: 3, title: 'Readme', why: 'w', kind: 'doc' },
        { node: 'checkout-page', path: 'AGENTS.md', start: 3, end: 9999, title: 'Checkout', why: 'w', kind: 'doc' },
        { node: 'checkout-page', path: 'src/pages/checkout/CheckoutPage.jsx', start: 1, end: 2, title: 'Header', why: 'w', kind: 'comment' },
        { node: 'cart-store', path: 'src/pages/checkout/CheckoutPage.jsx', start: 1, end: 2, title: 'Not its folder', kind: 'comment' },
        { node: 'payments', path: 'src/api/payments.js', start: 1, end: 2, title: 'No folder', kind: 'comment' },
        { node: 'nope', path: 'README.md', start: 1, end: 2 },
        { node: 'cart-store', path: 'missing.md', start: 1, end: 2 },
        { node: 'cart-store', path: '.env', start: 1, end: 1 },
    ], ['AGENTS.md', 'CLAUDE.md']);
    assert.deepEqual(Object.keys(links), ['checkout-page']);
    assert.deepEqual(links['checkout-page'].map((l) => [l.path, l.kind]), [
        ['AGENTS.md', 'guide'],
        ['README.md', 'doc'],
        ['src/pages/checkout/CheckoutPage.jsx', 'comment'],
    ]);
    assert.equal(links['checkout-page'][0].end, AGENTS.split('\n').length, 'clamped to the file');
    const noComments = await cleanLinks(dir, config({ docs: { comments: false } }), MAP, [
        { node: 'checkout-page', path: 'src/pages/checkout/CheckoutPage.jsx', start: 1, end: 2 },
    ]);
    assert.deepEqual(noComments, {});
});

test('the docs prompt lists documents with headings and marks agent guidance', () => {
    const p = docsPrompt(config(), MAP, { docFiles: [{ path: 'AGENTS.md', lines: 10, headings: ['L3 Checkout'] }], guidancePaths: ['AGENTS.md'], comments: false });
    assert.match(p, /AGENTS\.md \(10 lines\) \[agent guidance\]\n {4}L3 Checkout/);
    assert.match(p, /checkout-page/);
    assert.doesNotMatch(p, /doc comments in the code/);
});

/** A fake OpenAI-compatible server that answers the docs pass with fixed links. */
async function fakeAi(links, seen = []) {
    const server = createServer((req, res) => {
        let b = '';
        req.on('data', (c) => {
            b += c;
        });
        req.on('end', () => {
            res.setHeader('content-type', 'application/json');
            if (req.method === 'GET') {
                res.end(JSON.stringify({ data: [{ id: 'fake' }] }));
                return;
            }
            seen.push(JSON.parse(b).messages.find((m) => m.role === 'user').content);
            res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify({ links }) } }] }));
        });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    return { server, url: `http://127.0.0.1:${server.address().port}/v1` };
}

test('linkDocs runs the map’s agent and writes docs.json; status and pruning follow the commits', async (t) => {
    const { dir, commit } = shop();
    const seen = [];
    const ai = await fakeAi([{ node: 'checkout-page', path: 'AGENTS.md', start: 3, end: 6, title: 'Checkout', why: 'How checkout works' }], seen);
    t.after(() => ai.server.close());
    const cfg = withDefaults({ codeRoots: ['src/'] }, { localAi: { provider: 'api', api: { baseUrl: ai.url, model: 'fake' } } });
    const map = { ...MAP };
    const result = await linkDocs({ root: dir, config: cfg, map });
    assert.equal(result.counts.links, 1);
    assert.equal(result.counts.guide, 1);
    assert.match(seen[0], /GUIDANCE THIS REPO KEEPS FOR CODING AGENTS/);
    assert.match(seen[0], /AGENTS\.md \(\d+ lines\) \[agent guidance\]/);
    const docs = await loadDocs(dir);
    assert.equal(docs.links['checkout-page'][0].kind, 'guide');
    assert.ok(docs.commit);

    assert.deepEqual(await docsStatus(dir, cfg), { linked: true, commit: docs.commit, generatedAt: docs.generatedAt, changed: 0, files: [] });
    writeFileSync(path.join(dir, 'AGENTS.md'), AGENTS + '\n## More\n');
    writeFileSync(path.join(dir, 'src', 'stores', 'cart.js'), '// changed\n');
    commit('docs');
    const st = await docsStatus(dir, cfg);
    assert.equal(st.changed, 1, 'only documents count');
    assert.deepEqual(st.files, ['AGENTS.md']);

    assert.equal(await pruneDocs(dir, { nodes: [{ id: 'cart-store' }] }), 1);
    assert.deepEqual((await loadDocs(dir)).links, {});
    await assert.rejects(linkDocs({ root: dir, config: cfg, map: { groups: [], nodes: [], edges: [] } }), (err) => err.code === 'empty');
});

test('server: doc links in /api/map, saving the map’s agent, and one map job at a time', async (t) => {
    const { dir } = shop();
    const ai = await fakeAi([{ node: 'checkout-page', path: 'README.md', start: 1, end: 2, title: 'Readme', why: 'w' }]);
    writeFileSync(path.join(dir, '.repo-map', 'local.json'), JSON.stringify({ provider: 'api', api: { baseUrl: ai.url, model: 'fake' } }));
    const { server, port } = await startServer({ root: dir, port: 48000 + Math.floor(Math.random() * 1000), findFreePort: true });
    t.after(() => {
        server.close();
        ai.server.close();
    });
    const base = `http://127.0.0.1:${port}`;
    const H = { 'x-map': '1', 'content-type': 'application/json' };
    const put = (body) => fetch(`${base}/api/settings/generate`, { method: 'PUT', headers: H, body: JSON.stringify(body) });

    assert.equal((await put({ agent: 'api', model: '--nope' })).status, 400);
    assert.equal((await put({ agent: 'api', model: 'fake' })).status, 200);
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, '.repo-map', 'local.json'), 'utf8')).generate, { provider: 'api', model: 'fake', effort: '' });
    const agents = await (await fetch(`${base}/api/agents`, { headers: H })).json();
    assert.equal(agents.generateSet, true);
    assert.deepEqual(agents.generate, { agent: 'api', model: 'fake', effort: '' });

    // two jobs at once: the second is refused
    const [a, b] = await Promise.all([
        fetch(`${base}/api/docs/link`, { method: 'POST', headers: H }),
        new Promise((r) => setTimeout(r, 30)).then(() => fetch(`${base}/api/map/update`, { method: 'POST', headers: H })),
    ]);
    const events = (await a.text()).trim().split('\n').map((l) => JSON.parse(l));
    const result = events.find((e) => e.type === 'result');
    assert.equal(result.job, 'docs');
    assert.equal(result.counts.links, 1);
    assert.equal(b.status, 409);

    const map = await (await fetch(`${base}/api/map`, { headers: H })).json();
    assert.equal(map.docs['checkout-page'][0].path, 'README.md');
    const file = await fetch(`${base}/api/file?path=README.md&start=1&end=2`, { headers: H });
    assert.equal(file.status, 200, 'documents outside codeRoots are readable');
    assert.equal((await fetch(`${base}/api/file?path=.env`, { headers: H })).status, 400);
    const st = await (await fetch(`${base}/api/map/status`, { headers: H })).json();
    assert.equal(st.docs.linked, true);
    assert.equal(st.job, null);

    // back to "same as traces"
    assert.equal((await put({})).status, 200);
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, '.repo-map', 'local.json'), 'utf8')).generate, { provider: '', model: '', effort: '' });
});

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { withDefaults } from '../lib/config.mjs';
import { collectDiff } from '../lib/freshness.mjs';
import { normalizeReview, normalizeReviewFiles, reviewLabel } from '../lib/review-data.mjs';
import { prNumber, resolveReview, reviewStatus } from '../lib/review-source.mjs';
import { listPrs, listRefs } from '../lib/review-refs.mjs';
import { withCheckout } from '../lib/review-worktree.mjs';
import { runReview } from '../lib/review.mjs';
import { startServer } from '../lib/server.mjs';
import { normalizeSitemapTrace } from '../lib/sitemap-trace.mjs';

const SHOP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'shop');
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const COUPONS = 'export function applyCoupon(total, code) {\n    if (code === "SAVE10") return total * 0.9;\n    return total;\n}\n';

/**
 * A git copy of the example shop on main, with a "feature" branch that adds
 * src/api/coupons.js and changes orders.js. main stays checked out.
 */
function shopRepo(t) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'repo-map-review-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    cpSync(SHOP, dir, { recursive: true, filter: (src) => !src.includes(`${path.sep}traces`) && !src.endsWith('sitemap.json') });
    git(dir, 'init', '--quiet', '-b', 'main');
    git(dir, 'config', 'user.email', 'test@example.com');
    git(dir, 'config', 'user.name', 'Test');
    git(dir, 'config', 'core.autocrlf', 'false');
    git(dir, 'add', '-A');
    git(dir, 'commit', '--quiet', '-m', 'shop');
    git(dir, 'checkout', '--quiet', '-b', 'feature');
    writeFileSync(path.join(dir, 'src/api/coupons.js'), COUPONS);
    const orders = path.join(dir, 'src/api/orders.js');
    writeFileSync(orders, readFileSync(orders, 'utf8').replace("import { chargeCard } from './payments';", "import { chargeCard } from './payments';\nimport { applyCoupon } from './coupons';"));
    git(dir, 'add', '-A');
    git(dir, 'commit', '--quiet', '-m', 'Add coupons');
    git(dir, 'checkout', '--quiet', 'main');
    return dir;
}

const config = withDefaults({ codeRoots: ['src/'], defaultBranch: 'main' });

test('prNumber reads numbers and GitHub URLs only', () => {
    assert.equal(prNumber('12'), '12');
    assert.equal(prNumber('#7'), '7');
    assert.equal(prNumber('https://github.com/o/r/pull/31/files'), '31');
    assert.equal(prNumber('https://evil.example/o/r/pull/31'), '');
    assert.equal(prNumber('--help'), '');
});

test('resolveReview compares refs, refuses unsafe ones, and diffs head without checking it out', async (t) => {
    const dir = shopRepo(t);
    const source = await resolveReview(dir, config, { base: 'main', head: 'feature' });
    assert.equal(source.kind, 'refs');
    assert.equal(source.headSha, git(dir, 'rev-parse', 'feature'));
    assert.equal(source.mergeBase, git(dir, 'rev-parse', 'main'));
    assert.deepEqual(source.commits.map((c) => c.replace(/^\w+ /, '')), ['Add coupons']);
    // the default base is the default branch
    assert.equal((await resolveReview(dir, config, { head: 'feature' })).base, 'main');
    for (const bad of ['-x', 'main..feature', 'a b', '--output=x']) {
        await assert.rejects(resolveReview(dir, config, { base: bad, head: 'feature' }), { code: 'ref' });
    }
    await assert.rejects(resolveReview(dir, config, { base: 'main', head: 'nope' }), { code: 'ref' });

    const diff = await collectDiff(dir, config, source.mergeBase, source.headSha);
    const coupons = diff.files.find((f) => f.path === 'src/api/coupons.js');
    assert.equal(coupons.status, 'A');
    assert.equal(coupons.additions, 4);
    assert.ok(diff.files.find((f) => f.path === 'src/api/orders.js').additions >= 1);
    assert.match(diff.patch, /applyCoupon/);
});

test('withCheckout reads the head in a temporary worktree and always removes it', async (t) => {
    const dir = shopRepo(t);
    const sha = git(dir, 'rev-parse', 'feature');
    let seen = '';
    await withCheckout(dir, sha, async (readRoot) => {
        seen = readRoot;
        assert.notEqual(readRoot, dir);
        assert.equal(readFileSync(path.join(readRoot, 'src/api/coupons.js'), 'utf8'), COUPONS);
    });
    assert.equal(existsSync(seen), false);
    assert.equal(git(dir, 'worktree', 'list').split('\n').length, 1);
    await assert.rejects(withCheckout(dir, sha, async () => { throw new Error('boom'); }), /boom/);
    assert.equal(git(dir, 'worktree', 'list').split('\n').length, 1);
    // the checkout itself when it is already at that commit and clean
    await withCheckout(dir, git(dir, 'rev-parse', 'HEAD'), async (readRoot) => assert.equal(readRoot, dir));
    await assert.rejects(withCheckout(dir, '--evil', async () => {}), { code: 'ref' });
});

test('local reviews include uncommitted changes and go stale when they change', async (t) => {
    const dir = shopRepo(t);
    git(dir, 'checkout', '--quiet', 'feature');
    writeFileSync(path.join(dir, 'src/api/coupons.js'), COUPONS + '// more\n');
    const source = await resolveReview(dir, config, { local: true });
    assert.equal(source.kind, 'local');
    assert.equal(source.dirty, true);
    const diff = await collectDiff(dir, config, source.mergeBase, null);
    assert.equal(diff.files.find((f) => f.path === 'src/api/coupons.js').additions, 5);
    const review = normalizeReview(source);
    assert.equal((await reviewStatus(dir, config, review)).state, 'current');
    writeFileSync(path.join(dir, 'src/api/coupons.js'), COUPONS + '// even more\n');
    assert.equal((await reviewStatus(dir, config, review)).state, 'stale');
});

test('pull requests come from gh; a missing gh is explained', async (t) => {
    const dir = shopRepo(t);
    const sha = git(dir, 'rev-parse', 'feature'), base = git(dir, 'rev-parse', 'main');
    const fake = path.join(dir, 'fake-gh.mjs');
    writeFileSync(fake, `process.stdout.write(JSON.stringify({ number: 5, title: 'Coupons', body: 'Adds coupons', url: 'https://github.com/o/r/pull/5',
        baseRefName: 'main', headRefName: 'feature', headRefOid: ${JSON.stringify(sha)}, baseRefOid: ${JSON.stringify(base)}, state: 'OPEN' }));`);
    const ghBin = [process.execPath, fake];
    const source = await resolveReview(dir, config, { pr: 'https://github.com/o/r/pull/5' }, { ghBin });
    assert.equal(source.kind, 'pr');
    assert.equal(source.number, 5);
    assert.equal(source.headSha, sha);
    assert.equal(source.body, 'Adds coupons');
    assert.equal((await reviewStatus(dir, config, normalizeReview(source), { ghBin })).state, 'current');
    assert.equal((await reviewStatus(dir, config, normalizeReview({ ...source, headSha: base }), { ghBin })).state, 'stale');
    await assert.rejects(resolveReview(dir, config, { pr: '5' }, { ghBin: 'repo-map-no-such-gh' }), { code: 'missing' });
    await assert.rejects(resolveReview(dir, config, { pr: 'nope' }, { ghBin }), { code: 'pr' });
});

test('normalizeReviewFiles keeps diff files and known cards, and lists files the AI left out', () => {
    const diff = [{ path: 'src/a.js', status: 'M', additions: 2, deletions: 1 }, { path: 'src/b.js', status: 'A', additions: 5, deletions: 0 }];
    const files = normalizeReviewFiles([
        { path: 'src/a.js', cards: ['x', 'ghost'], note: 'changed' },
        { path: 'src/not-in-diff.js', cards: ['x'] },
        { path: '../etc/passwd', cards: [] },
    ], diff, new Set(['x']));
    assert.deepEqual(files, [
        { path: 'src/a.js', status: 'M', additions: 2, deletions: 1, cards: ['x'], note: 'changed' },
        { path: 'src/b.js', status: 'A', additions: 5, deletions: 0, cards: [], note: '' },
    ]);
    assert.equal(normalizeReview({ kind: 'pr', baseSha: 'zz', headSha: 'abcdef1' }), null);
    assert.equal(reviewLabel(normalizeReview({ kind: 'pr', number: 3, baseSha: 'abcdef1', headSha: 'abcdef2' })), 'PR #3');
    assert.ok(normalizeSitemapTrace, 'sitemap changes are shared with proposals');
});

test('runReview turns the AI reply into a review trace and repairs a bad format once', async () => {
    const map = { groups: [{ id: 'g-api', col: 0, title: 'API' }], nodes: [{ id: 'orders-client', group: 'g-api', kind: 'service' }], edges: [] };
    const source = { kind: 'refs', base: 'main', head: 'feature', baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40), mergeBase: 'a'.repeat(40), title: 'feature → main', commits: [] };
    const diff = { files: [{ path: 'src/api/coupons.js', status: 'A', additions: 4, deletions: 0 }], stat: '', patch: '+x', skipped: [] };
    const reply = { title: 'Coupons', summary: 'Adds coupons.', risks: ['No tests'], questions: [], gaps: '',
        steps: [{ id: 'ghost', note: 'dropped', refs: [] }, { id: 'proposal:coupons', note: 'new', refs: [] }, { id: 'orders-client', note: 'applies it', refs: [] },
            { id: 'proposal:coupons', note: 'again', refs: [{ path: 'src/api/coupons.js', start: 1, end: 2 }] }],
        edges: [], changes: { nodes: [{ id: 'proposal:coupons', status: 'new', title: 'Coupons', group: 'g-api' }, { id: 'orders-client', status: 'modified' }], edges: [] },
        flow: { nodes: [{ id: 'f1', type: 'start', label: 'Order', step: 3 }, { id: 'f2', type: 'end', label: 'Done', status: 'new' }], edges: [{ from: 'f1', to: 'f2' }] },
        files: [{ path: 'src/api/coupons.js', cards: ['proposal:coupons'], note: 'new module' }] };
    const prompts = [];
    const replies = [{ text: 'not json' }, { text: JSON.stringify(reply), cost: 1 }];
    const runner = runReview({ readRoot: '.', config: withDefaults({}), map, source, diff, selection: { agent: { id: 'command' }, label: 'Test' },
        run: (_, request) => { prompts.push(request); return { kill() {}, promise: Promise.resolve(replies[prompts.length - 1]) }; } });
    const { trace } = await runner.promise;
    assert.equal(prompts.length, 2);
    assert.match(prompts[0].prompt, /code AFTER the change/);
    assert.equal(trace.intent, 'review');
    assert.deepEqual(trace.steps.map((s) => s.id), ['proposal:coupons', 'orders-client'], 'unknown and repeated cards dropped');
    assert.equal(trace.steps[0].refs.length, 1, "a repeat's refs join the first visit");
    assert.equal(trace.flow.nodes[0].step, 2, 'flow steps follow the kept steps');
    assert.deepEqual(trace.proposal.nodes.map((n) => n.status), ['new', 'modified']);
    assert.deepEqual(trace.review.files[0].cards, ['proposal:coupons']);
    assert.deepEqual(trace.review.risks, ['No tests']);
    assert.equal(trace.prompt, 'Review feature against main');
});

test('runReview leaves the flowchart out when it was not asked for', async () => {
    const map = { groups: [{ id: 'g-api', col: 0, title: 'API' }], nodes: [{ id: 'orders-client', group: 'g-api', kind: 'service' }], edges: [] };
    const source = { kind: 'refs', base: 'main', head: 'feature', baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40), mergeBase: 'a'.repeat(40), title: 'feature → main', commits: [] };
    const diff = { files: [{ path: 'src/api/orders.js', status: 'M', additions: 1, deletions: 0 }], stat: '', patch: '+x', skipped: [] };
    const reply = { title: 'Orders', summary: 'Tweaks orders.', risks: [], questions: [], gaps: '',
        steps: [{ id: 'orders-client', note: 'changed', refs: [] }], edges: [],
        changes: { nodes: [{ id: 'orders-client', status: 'modified' }], edges: [] },
        files: [{ path: 'src/api/orders.js', cards: ['orders-client'], note: '' }] };
    const requests = [];
    const runner = runReview({ readRoot: '.', config: withDefaults({}), map, source, diff, flow: false, selection: { agent: { id: 'command' }, label: 'Test' },
        run: (_, request) => { requests.push(request); return { kill() {}, promise: Promise.resolve({ text: JSON.stringify(reply) }) }; } });
    const { trace } = await runner.promise;
    assert.equal(requests.length, 1, 'a reply without a flow matches the contract');
    assert.doesNotMatch(requests[0].prompt, /"flow":\{"nodes"/);
    assert.match(requests[0].prompt, /No flowchart was asked for/);
    assert.ok(!requests[0].responseSchema.required.includes('flow'));
    assert.equal(trace.flow, null);
    assert.deepEqual(trace.steps.map((s) => s.id), ['orders-client']);
});

test('review API: streams a review read at the head, pins refs, reads files and diffs at commits, and reports staleness', async (t) => {
    const dir = shopRepo(t);
    const prompts = [];
    const fake = createServer((req, res) => {
        let b = '';
        req.on('data', (c) => (b += c));
        req.on('end', () => {
            if (req.method === 'GET') return res.end(JSON.stringify({ data: [{ id: 'fake' }] }));
            const body = JSON.parse(b);
            prompts.push(body.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n'));
            const reply = { title: 'Coupons', summary: 'Adds coupon codes to orders.', risks: [], questions: ['Is SAVE10 permanent?'], gaps: '',
                steps: [{ id: 'orders-client', note: 'applies coupons', refs: [{ path: 'src/api/coupons.js', start: 1, end: 3, why: 'new code' }, { path: '.env', start: 1, end: 1, why: 'no' }] }],
                edges: [], changes: { rationale: 'New coupon module', nodes: [{ id: 'orders-client', status: 'modified', rationale: 'uses coupons' }], edges: [] },
                flow: { nodes: [{ id: 'f1', type: 'start', label: 'Place order', step: 1 }, { id: 'f2', type: 'process', label: 'Apply coupon', status: 'new' }, { id: 'f3', type: 'end', label: 'Done' }],
                    edges: [{ from: 'f1', to: 'f2' }, { from: 'f2', to: 'f3' }] },
                files: [{ path: 'src/api/coupons.js', cards: ['orders-client'], note: 'coupon rules' }] };
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(reply) }, finish_reason: 'stop' }] }));
        });
    });
    await new Promise((r) => fake.listen(0, '127.0.0.1', r));
    writeFileSync(path.join(dir, '.repo-map', 'local.json'), JSON.stringify({ ai: { provider: 'api', api: { baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model: 'fake' } } }));
    const { server, port } = await startServer({ root: dir, port: 49100 + Math.floor(Math.random() * 300), findFreePort: true });
    t.after(() => { server.close(); fake.close(); });
    const H = { 'x-map': '1', 'content-type': 'application/json' };
    const api = (p, init) => fetch(`http://127.0.0.1:${port}${p}`, { headers: H, ...init });
    const stream = async (body) => (await (await api('/api/review', { method: 'POST', body: JSON.stringify(body) })).text())
        .trim().split('\n').map((l) => JSON.parse(l));

    const events = await stream({ base: 'main', head: 'feature' });
    const out = events.find((e) => e.type === 'result' || e.type === 'error');
    assert.equal(out.type, 'result', JSON.stringify(out));
    assert.ok(events.some((e) => e.type === 'title' && e.title === 'feature → main'));
    assert.match(prompts.at(-1), /applyCoupon/);
    const head = git(dir, 'rev-parse', 'feature');
    const { trace } = out;
    assert.equal(trace.intent, 'review');
    assert.equal(trace.review.headSha, head);
    // the new file only exists at the head: kept, pinned to it; .env dropped
    assert.deepEqual(trace.steps[0].refs.map((r) => [r.path, r.rev]), [['src/api/coupons.js', head]]);
    assert.deepEqual(trace.review.files.map((f) => f.path).sort(), ['src/api/coupons.js', 'src/api/orders.js']);
    assert.equal(trace.flow.nodes[1].status, 'new');
    assert.equal(git(dir, 'worktree', 'list').split('\n').length, 1, 'worktree removed');
    assert.equal(git(dir, 'branch', '--show-current'), 'main', 'checkout untouched');

    const file = await (await api(`/api/file?path=src/api/coupons.js&start=1&end=2&rev=${head}`)).json();
    assert.deepEqual(file.lines, COUPONS.split('\n').slice(0, 2));
    assert.equal((await api(`/api/file?path=.env&rev=${head}`)).status, 400);
    assert.equal((await api(`/api/file?path=src/api/coupons.js&rev=--evil`)).status, 400);
    const diff = await (await api(`/api/diff?path=src/api/orders.js&base=${trace.review.mergeBase}&head=${head}`)).json();
    assert.ok(diff.lines.some((l) => l.startsWith("+import { applyCoupon } from './coupons';")));
    assert.equal((await api(`/api/diff?path=src/api/orders.js&base=main&head=${head}`)).status, 400);

    const status = async () => (await api('/api/review/status', { method: 'POST', body: JSON.stringify({ review: trace.review }) })).json();
    assert.equal((await status()).state, 'current');
    git(dir, 'checkout', '--quiet', 'feature');
    writeFileSync(path.join(dir, 'src/api/coupons.js'), COUPONS + '// v2\n');
    git(dir, 'commit', '--quiet', '-am', 'v2');
    git(dir, 'checkout', '--quiet', 'main');
    assert.equal((await status()).state, 'stale');

    // nothing to review is an error, not an empty review
    const none = (await stream({ base: 'main', head: 'main' })).find((e) => e.type === 'error');
    assert.equal(none.code, 'empty');
    const bad = (await stream({ base: '-x' })).find((e) => e.type === 'error');
    assert.equal(bad.code, 'ref');
});

test('listRefs lists branches, remote branches and tags, newest first, with counts against the base', async (t) => {
    const dir = shopRepo(t);
    git(dir, 'tag', 'v1', 'main');
    const clone = mkdtempSync(path.join(os.tmpdir(), 'repo-map-clone-'));
    t.after(() => rmSync(clone, { recursive: true, force: true }));
    git(clone, 'clone', '--quiet', dir, '.');
    const out = await listRefs(clone, config);
    assert.equal(out.current, 'main');
    assert.equal(out.aheadOf, 'origin/main');
    const byName = Object.fromEntries(out.refs.map((r) => [r.name, r]));
    // origin/main is the same commit as main: listed once, as local
    assert.equal(byName['origin/main'], undefined);
    assert.equal(byName.main.alsoRemote, true);
    assert.equal(byName['origin/feature'].kind, 'remote');
    assert.equal(byName['origin/feature'].ahead, 1);
    assert.equal(byName.main.ahead, 0);
    assert.equal(byName.v1.kind, 'tag');
    assert.equal(byName.v1.ahead, undefined);
    assert.ok(out.refs.every((r, i) => !i || out.refs[i - 1].date >= r.date), 'newest first');
    assert.equal(out.refs.some((r) => /HEAD$/.test(r.name)), false);
    // against another base
    const other = await listRefs(clone, config, { base: 'origin/feature' });
    assert.deepEqual([other.refs.find((r) => r.name === 'main').ahead, other.refs.find((r) => r.name === 'main').behind], [0, 1]);
    await assert.rejects(listRefs(clone, config, { base: 'nope' }), { status: 400 });
    await assert.rejects(listRefs(clone, config, { base: '--all' }), { code: 'ref' });
});

test('listPrs reads open pull requests from gh, and explains when gh is missing', async (t) => {
    const dir = shopRepo(t);
    const fake = path.join(dir, 'fake-gh-list.mjs');
    writeFileSync(fake, `process.stdout.write(JSON.stringify([{ number: 7, title: 'Coupons', author: { login: 'sam' }, headRefName: 'feature', baseRefName: 'main', updatedAt: '2026-01-01', isDraft: true }]));`);
    const { prs } = await listPrs(dir, { ghBin: [process.execPath, fake] });
    assert.deepEqual(prs, [{ number: 7, title: 'Coupons', author: 'sam', head: 'feature', base: 'main', updatedAt: '2026-01-01', draft: true }]);
    const missing = await listPrs(dir, { ghBin: 'repo-map-no-such-gh' });
    assert.deepEqual(missing.prs, []);
    assert.match(missing.reason, /isn't installed/);
});

test('review refs API: lists refs, refuses a bad base, and fetches new remote branches', async (t) => {
    const dir = shopRepo(t);
    const clone = mkdtempSync(path.join(os.tmpdir(), 'repo-map-clone-'));
    t.after(() => rmSync(clone, { recursive: true, force: true }));
    git(clone, 'clone', '--quiet', dir, '.');
    git(dir, 'branch', 'later', 'feature');
    const { server, port } = await startServer({ root: clone, port: 49400 + Math.floor(Math.random() * 90), findFreePort: true });
    t.after(() => server.close());
    const H = { 'x-map': '1' };
    const refs = async (q = '') => fetch(`http://127.0.0.1:${port}/api/review/refs${q}`, { headers: H });
    assert.equal((await (await refs()).json()).refs.some((r) => r.name === 'origin/later'), false);
    assert.equal((await refs('?base=nope')).status, 400);
    const fetched = await fetch(`http://127.0.0.1:${port}/api/review/fetch`, { method: 'POST', headers: H });
    assert.equal(fetched.status, 200);
    assert.ok((await fetched.json()).fetchedAt);
    assert.equal((await (await refs()).json()).refs.some((r) => r.name === 'origin/later'), true);
});

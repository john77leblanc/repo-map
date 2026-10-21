import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig, loadMap } from '../lib/config.mjs';
import { mapStatus, markCurrent } from '../lib/freshness.mjs';
import { applyPatch, updateMap } from '../lib/update.mjs';

const BASE = {
    groups: [{ id: 'g', col: 1, title: 'App', open: true }],
    nodes: [{ id: 'web', group: 'g', kind: 'service', path: 'src/web', desc: 'Pages.' }, { id: 'api', group: 'g', kind: 'service', path: 'src/api', desc: 'Clients.' }],
    edges: [{ from: 'web', to: 'api', type: 'event' }],
};

test('applyPatch adds, updates and removes, and drops edges to removed nodes', () => {
    const r = applyPatch(BASE, {
        summary: 'Added billing.',
        nodes: { add: [{ id: 'billing', group: 'g', kind: 'service', path: 'src/billing', desc: 'Billing.' }, { id: 'web', group: 'g', kind: 'service' }], update: [{ id: 'web', desc: 'Pages and routes.' }], remove: ['api'] },
        edges: { add: [{ from: 'web', to: 'billing', type: 'http' }, { from: 'web', to: 'ghost', type: 'http' }] },
    });
    assert.deepEqual(r.map.nodes.map((n) => n.id), ['web', 'billing']);
    assert.equal(r.map.nodes[0].desc, 'Pages and routes.');
    assert.deepEqual(r.map.edges, [{ from: 'web', to: 'billing', type: 'http' }]);
    assert.deepEqual(r.counts, { added: 3, updated: 1, removed: 2 });
    assert.equal(r.summary, 'Added billing.');
    assert.deepEqual(BASE.nodes.map((n) => n.id), ['web', 'api'], 'input is not mutated');
});

test('applyPatch with an empty patch changes nothing', () => {
    const r = applyPatch(BASE, { summary: 'Nothing to change.' });
    assert.deepEqual(r.map, BASE);
    assert.deepEqual(r.counts, { added: 0, updated: 0, removed: 0 });
});

function gitRepo() {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'repo-map-git-'));
    const g = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();
    g('init', '-q');
    mkdirSync(path.join(dir, 'src', 'web'), { recursive: true });
    mkdirSync(path.join(dir, 'src', 'api'), { recursive: true });
    mkdirSync(path.join(dir, 'docs'), { recursive: true });
    mkdirSync(path.join(dir, '.repo-map'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'web', 'page.js'), 'export const page = 1;\n');
    writeFileSync(path.join(dir, 'src', 'api', 'client.js'), 'export const client = 1;\n');
    writeFileSync(path.join(dir, '.repo-map', 'config.json'), JSON.stringify({ name: 'T', codeRoots: ['src/'], github: false }));
    g('add', '-A');
    g('commit', '-qm', 'one');
    const head = g('rev-parse', 'HEAD');
    writeFileSync(path.join(dir, '.repo-map', 'map.json'), JSON.stringify({ ...BASE, commit: head }));
    return { dir, g, head };
}

test('map status tracks changes under codeRoots only', async () => {
    const { dir, g } = gitRepo();
    const config = await loadConfig(dir);
    assert.equal((await mapStatus(dir, config, await loadMap(dir))).state, 'current');

    writeFileSync(path.join(dir, 'docs', 'notes.md'), 'notes\n');
    g('add', '-A');
    g('commit', '-qm', 'docs only');
    assert.equal((await mapStatus(dir, config, await loadMap(dir))).state, 'current', 'changes outside codeRoots are ignored');

    mkdirSync(path.join(dir, 'src', 'billing'));
    writeFileSync(path.join(dir, 'src', 'billing', 'charge.js'), 'export function charge() {}\n');
    g('add', '-A');
    g('commit', '-qm', 'billing');
    const st = await mapStatus(dir, config, await loadMap(dir));
    assert.equal(st.state, 'stale');
    assert.equal(st.changed, 1);
    assert.deepEqual(st.files, ['src/billing/charge.js']);
    assert.equal(st.commitsSince, 2);

    await markCurrent(dir);
    assert.equal((await mapStatus(dir, config, await loadMap(dir))).state, 'current');
});

test('a map without a recorded commit reports "unrecorded"', async () => {
    const { dir } = gitRepo();
    writeFileSync(path.join(dir, '.repo-map', 'map.json'), JSON.stringify(BASE));
    const config = await loadConfig(dir);
    assert.equal((await mapStatus(dir, config, await loadMap(dir))).state, 'unrecorded');
});

test('updateMap sends only the diff and applies the returned patch', async () => {
    const { dir, g } = gitRepo();
    mkdirSync(path.join(dir, 'src', 'billing'));
    writeFileSync(path.join(dir, 'src', 'billing', 'charge.js'), 'export function charge() { return fetch("https://pay.example.com"); }\n');
    g('add', '-A');
    g('commit', '-qm', 'billing');
    const newHead = g('rev-parse', 'HEAD');

    let prompt = '';
    const server = createServer((req, res) => {
        let body = '';
        req.on('data', (d) => {
            body += d;
        });
        req.on('end', () => {
            prompt = JSON.parse(body).messages.find((m) => m.role === 'user').content;
            const patch = { summary: 'Added the billing module.', nodes: { add: [{ id: 'billing', group: 'g', kind: 'service', path: 'src/billing', desc: 'Charges cards.' }] }, edges: { add: [{ from: 'api', to: 'billing', type: 'event' }] } };
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(patch) } }] }));
        });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
        writeFileSync(path.join(dir, '.repo-map', 'local.json'), JSON.stringify({ provider: 'api', api: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'm' } }));
        const config = await loadConfig(dir);
        const result = await updateMap({ root: dir, config });
        assert.equal(result.state, 'updated');
        assert.deepEqual(result.counts, { added: 2, updated: 0, removed: 0 });
        assert.match(prompt, /src\/billing\/charge\.js/);
        assert.match(prompt, /pay\.example\.com/);
        assert.doesNotMatch(prompt, /export const page = 1/, 'unchanged files are not sent');
        const map = JSON.parse(readFileSync(path.join(dir, '.repo-map', 'map.json'), 'utf8'));
        assert.equal(map.commit, newHead);
        assert.ok(map.nodes.some((n) => n.id === 'billing'));
        assert.equal(JSON.parse(readFileSync(path.join(dir, '.repo-map', 'map.prev.json'), 'utf8')).nodes.length, 2);
        assert.equal((await updateMap({ root: dir, config })).state, 'current');
    } finally {
        server.close();
    }
});

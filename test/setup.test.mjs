import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { startServer } from '../lib/server.mjs';

const EXAMPLE = fileURLToPath(new URL('../examples/shop/', import.meta.url));

async function serve(t) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'repo-map-setup-'));
    const root = path.join(dir, 'repo');
    cpSync(EXAMPLE, root, { recursive: true });
    mkdirSync(path.join(root, 'scripts'));
    mkdirSync(path.join(root, 'node_modules'));
    // keep the personal settings file inside the sandbox
    const saved = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = path.join(dir, 'xdg');
    const { server } = await startServer({ root, port: 49000 + Math.floor(Math.random() * 1000), findFreePort: true });
    t.after(() => {
        server.closeAllConnections();
        server.close();
        if (saved === undefined) delete process.env.XDG_CONFIG_HOME;
        else process.env.XDG_CONFIG_HOME = saved;
        rmSync(dir, { recursive: true, force: true });
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = (url, method = 'GET', body) => fetch(base + url, {
        method, headers: { 'x-map': '1', 'content-type': 'application/json' }, body: body && JSON.stringify(body),
    });
    return { dir, root, call };
}

test('setup endpoint lists top-level folders and the current answers', async (t) => {
    const { call } = await serve(t);
    const info = await (await call('/api/setup')).json();
    const dirs = info.dirs.map((d) => d.path);
    assert.ok(dirs.includes('src/'));
    assert.ok(dirs.includes('scripts/'));
    assert.ok(!dirs.includes('node_modules/'), 'blocked folders are not offered');
    assert.ok(!dirs.some((d) => d.startsWith('.')), 'dot folders are not offered');
    assert.equal(info.dirs.find((d) => d.path === 'src/').suggested, true);
    assert.ok(info.name);
    assert.ok(Array.isArray(info.codeRoots));
});

test('saving setup writes config.json and refuses folders outside the repo', async (t) => {
    const { root, call } = await serve(t);
    const put = (body) => call('/api/setup', 'PUT', body);
    for (const codeRoots of [['../'], ['src/../../x'], ['.repo-map/'], ['missing/'], ['/etc'], ['.env.local/'], []]) {
        const res = await put({ name: 'Shop', codeRoots });
        assert.equal(res.status, 400, `refuses ${JSON.stringify(codeRoots)}`);
        assert.ok((await res.json()).error);
    }
    assert.equal((await put({ name: '  ', codeRoots: ['src/'] })).status, 400);
    assert.equal((await put({ name: 'Shop', codeRoots: ['src/'], context: 'x'.repeat(1001) })).status, 400);
    const res = await put({ name: 'Shop map', codeRoots: ['src', './scripts/'], context: 'A demo shop.' });
    assert.equal(res.status, 200);
    const config = JSON.parse(readFileSync(path.join(root, '.repo-map', 'config.json'), 'utf8'));
    assert.equal(config.name, 'Shop map');
    assert.deepEqual(config.codeRoots, ['src/', 'scripts/']);
    assert.equal(config.prompt.context, 'A demo shop.');
    assert.ok(config.columns, 'other settings are kept');
});

test('saving the trace tool writes the personal settings file', async (t) => {
    const { dir, root, call } = await serve(t);
    // a tool this machine "has": a command agent backed by node
    writeFileSync(path.join(root, '.repo-map', 'local.json'), JSON.stringify({ provider: 'command', command: { bin: process.execPath, label: 'Node' } }));
    assert.equal((await call('/api/settings/trace', 'PUT', {})).status, 400);
    assert.equal((await call('/api/settings/trace', 'PUT', { agent: 'nope' })).status, 400);
    const res = await call('/api/settings/trace', 'PUT', { agent: 'command' });
    assert.equal(res.status, 200, await res.clone().text());
    const file = path.join(dir, 'xdg', 'repo-map', 'ai.json');
    assert.ok(existsSync(file));
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(saved.provider, 'command');
    assert.equal(saved.command.model, '');
});

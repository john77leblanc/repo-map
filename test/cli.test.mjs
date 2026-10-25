import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'repo-map.mjs');

function sandbox() {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'repo-map-cli-'));
    const repo = path.join(dir, 'repo');
    mkdirSync(path.join(repo, 'src'), { recursive: true });
    writeFileSync(path.join(repo, 'src', 'index.js'), 'export default 1;\n');
    const env = { ...process.env, XDG_CONFIG_HOME: path.join(dir, 'xdg'), PATH: path.dirname(process.execPath), REPO_MAP_API_KEY: '', OPENAI_API_KEY: '' };
    const run = (...args) => spawnSync(process.execPath, [BIN, ...args], { cwd: repo, env, encoding: 'utf8' });
    return { dir, repo, run, read: (rel) => JSON.parse(readFileSync(path.join(repo, rel), 'utf8')), readGlobal: () => JSON.parse(readFileSync(path.join(dir, 'xdg', 'repo-map', 'ai.json'), 'utf8')) };
}

test('init is non-interactive, takes flags, and is safe to re-run', () => {
    const s = sandbox();
    assert.equal(s.run('init', '--name', 'Demo', '--roots', 'src,lib', '--context', 'A demo.', '--github', 'false').status, 0);
    let cfg = s.read('.repo-map/config.json');
    assert.equal(cfg.name, 'Demo');
    assert.deepEqual(cfg.codeRoots, ['src/', 'lib/']);
    assert.equal(cfg.github, false);
    assert.equal(cfg.prompt.context, 'A demo.');
    assert.match(readFileSync(path.join(s.repo, '.repo-map', '.gitignore'), 'utf8'), /local\.json/);

    assert.equal(s.run('init').status, 0);
    assert.deepEqual(s.read('.repo-map/config.json'), cfg);

    assert.equal(s.run('init', '--context=Changed.').status, 0);
    cfg = s.read('.repo-map/config.json');
    assert.equal(cfg.prompt.context, 'Changed.');
    assert.equal(cfg.name, 'Demo');
});

test('ai saves settings to the chosen scope', () => {
    const s = sandbox();
    s.run('init');
    assert.equal(s.run('ai', 'ollama', '--model', 'qwen2.5-coder:14b').status, 0);
    assert.deepEqual(s.readGlobal(), { provider: 'ollama', ollama: { model: 'qwen2.5-coder:14b' }, effort: '' });

    // a separate tool, model and effort for drawing the map; the trace default is kept
    assert.equal(s.run('ai', 'claude', '--model', 'opus', '--effort', 'high', '--for', 'generate').status, 0);
    assert.deepEqual(s.readGlobal(), { provider: 'ollama', ollama: { model: 'qwen2.5-coder:14b' }, effort: '', generate: { provider: 'claude', model: 'opus', effort: 'high' } });
    assert.notEqual(s.run('ai', 'claude', '--for', 'everything').status, 0);

    assert.equal(s.run('ai', 'codex', '--local', '--effort', 'low').status, 0);
    assert.deepEqual(s.read('.repo-map/local.json'), { provider: 'codex', codex: {}, effort: 'low' });

    assert.equal(s.run('ai', 'claude', '--repo').status, 0);
    assert.equal(s.read('.repo-map/config.json').ai.provider, 'claude');

    const shown = JSON.parse(s.run('ai', 'show').stdout);
    assert.equal(shown.provider, 'codex'); // local.json wins over global and repo
    assert.equal(shown.effort, 'low');
    assert.deepEqual(shown.generate, { provider: 'claude', model: 'opus', effort: 'high' });

    assert.notEqual(s.run('ai', 'openai').status, 0); // needs --model
    assert.notEqual(s.run('ai', 'wizard').status, 0);
});

test('doctor --json reports readiness with an exit code', () => {
    const s = sandbox();
    s.run('init');
    s.run('ai', 'none', '--local');
    const r = s.run('doctor', '--json');
    assert.equal(r.status, 1);
    assert.equal(JSON.parse(r.stdout).ready, false);
});

test('generate is no longer a command (the first map is built in the browser), and validate passes', () => {
    const s = sandbox();
    s.run('init', '--roots', 'src');
    writeFileSync(path.join(s.repo, '.repo-map', 'map.json'), JSON.stringify({
        groups: [{ id: 'g', col: 1, title: 'App', open: true }],
        nodes: [{ id: 'app', group: 'g', kind: 'service', path: 'src', desc: 'The app.' }],
        edges: [],
    }));
    const gen = s.run('generate');
    assert.equal(gen.status, 1);
    assert.doesNotMatch(gen.stdout, /^ {2}generate /m);
    assert.equal(s.run('validate').status, 0);
});

test('docs --check reports whether documentation is linked, with an exit code', () => {
    const s = sandbox();
    s.run('init', '--roots', 'src');
    const first = s.run('docs', '--check');
    assert.equal(first.status, 1);
    assert.match(first.stdout, /isn’t linked/);
    writeFileSync(path.join(s.repo, '.repo-map', 'docs.json'), JSON.stringify({ links: { app: [{ path: 'README.md', start: 1, end: 1, kind: 'doc' }] } }));
    const second = s.run('docs', '--check');
    assert.equal(second.status, 0);
    assert.match(second.stdout, /up to date/);
    // validate warns about links to cards that aren't on the map
    writeFileSync(path.join(s.repo, '.repo-map', 'map.json'), JSON.stringify({ groups: [{ id: 'g', col: 1, title: 'App' }], nodes: [{ id: 'other', group: 'g', kind: 'service', path: 'src' }], edges: [] }));
    assert.match(s.run('validate').stdout, /unknown node app/);
});

test('unknown flags fail loudly', () => {
    const s = sandbox();
    const r = s.run('init', '--nmae', 'x');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Unknown option --nmae/);
    assert.ok(execFileSync(process.execPath, [BIN, '--version'], { encoding: 'utf8' }).trim());
});

test('running with no command sets everything up without questions when there is no terminal', async () => {
    const s = sandbox();
    mkdirSync(path.join(s.repo, 'src', 'api'), { recursive: true });
    const { spawn } = await import('node:child_process');
    const child = spawn(process.execPath, [BIN, '--port', '0'], {
        cwd: s.repo,
        env: { ...process.env, XDG_CONFIG_HOME: path.join(s.dir, 'xdg'), PATH: path.dirname(process.execPath), REPO_MAP_API_KEY: '', OPENAI_API_KEY: '' },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out:\n${out}`)), 10000);
        child.stdout.on('data', (d) => {
            out += d;
            if (out.includes('Press Ctrl+C')) {
                clearTimeout(timer);
                resolve();
            }
        });
        child.stderr.on('data', (d) => {
            out += d;
        });
    });
    child.kill();
    assert.match(out, /Created \.repo-map\/config\.json/);
    assert.match(out, /No map yet\. Finish setup in the browser/);
    assert.match(out, /→ http:\/\/localhost:\d+/);
    // the first map is built from the browser's starter screen, not here
    assert.equal(existsSync(path.join(s.repo, '.repo-map', 'map.json')), false);
});

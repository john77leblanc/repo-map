import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { extractJson } from '../lib/claude.mjs';
import { loadConfig, loadMap, withDefaults } from '../lib/config.mjs';
import { mapText, tracePrompt } from '../lib/prompts.mjs';
import { githubFromRemote, safePath } from '../lib/repo.mjs';
import { validateMap } from '../lib/validate.mjs';

const EXAMPLE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'shop');

test('the bundled example map is valid', async () => {
    const config = await loadConfig(EXAMPLE);
    const { errors, warnings, counts } = validateMap(EXAMPLE, config, await loadMap(EXAMPLE));
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
    assert.equal(counts.nodes, 8);
});

test('validate reports unknown references', () => {
    const config = withDefaults({});
    const map = {
        groups: [{ id: 'g', col: 9, title: 'G' }],
        nodes: [{ id: 'a', group: 'nope', kind: 'service' }, { id: 'a', group: 'g', kind: 'widget' }],
        edges: [{ from: 'a', to: 'ghost', type: 'http' }, { from: 'a', to: 'a', type: 'teleport' }],
    };
    const { errors } = validateMap(EXAMPLE, config, map);
    assert.ok(errors.some((e) => e.includes('col 9')));
    assert.ok(errors.some((e) => e.includes('Duplicate node id: a')));
    assert.ok(errors.some((e) => e.includes('unknown group nope')));
    assert.ok(errors.some((e) => e.includes('unknown kind widget')));
    assert.ok(errors.some((e) => e.includes('unknown node ghost')));
    assert.ok(errors.some((e) => e.includes('unknown type teleport')));
});

test('safePath keeps reads inside codeRoots', () => {
    const config = withDefaults({ codeRoots: ['src'] });
    const root = '/repo';
    assert.equal(safePath(root, config, 'src/api/orders.js').clean, 'src/api/orders.js');
    assert.equal(safePath(root, config, '/src/api/orders.js').clean, 'src/api/orders.js');
    assert.equal(safePath(root, config, 'src/../../etc/passwd'), null);
    assert.equal(safePath(root, config, 'lib/secret.js'), null);
    assert.equal(safePath(root, config, 'src/.env'), null);
    assert.equal(safePath(root, config, 'src/.env.local'), null);
    assert.equal(safePath(root, config, 'src/node_modules/x/index.js'), null);
});

test('extractJson accepts bare JSON, fenced JSON and JSON with prose around it', () => {
    assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
    assert.deepEqual(extractJson('Here you go:\n```json\n{"a":2}\n```'), { a: 2 });
    assert.deepEqual(extractJson('Result: {"a":3} done.'), { a: 3 });
    assert.equal(extractJson('no json here'), null);
});

test('githubFromRemote reads ssh and https remotes', () => {
    assert.equal(githubFromRemote('git@github.com:someone/thing.git'), 'someone/thing');
    assert.equal(githubFromRemote('https://github.com/someone/thing'), 'someone/thing');
    assert.equal(githubFromRemote('https://gitlab.com/someone/thing'), '');
});

test('prompts include the map and the question', async () => {
    const config = await loadConfig(EXAMPLE);
    const map = await loadMap(EXAMPLE);
    assert.match(mapText(config, map), /checkout-page \| checkout-page \| module/);
    const prompt = tracePrompt(config, map, 'What happens when someone places an order?');
    assert.match(prompt, /PROCESS\nWhat happens when someone places an order\?$/);
    assert.match(prompt, /src\//);
});

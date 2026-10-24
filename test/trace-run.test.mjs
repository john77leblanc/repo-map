import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withDefaults } from '../lib/config.mjs';
import { runTrace } from '../lib/trace-run.mjs';

function setup(replies, options = {}) {
    const prompts = [], progress = [];
    const selection = { agent: { id: 'command', models: [], efforts: [] }, label: 'Test' };
    const runner = runTrace({ root: '.', config: withDefaults({}),
        map: { nodes: [], groups: [], edges: [] }, question: 'Explain checkout', selection,
        resolve: async () => selection, onProgress: value => progress.push(value),
        run: (_, request) => {
            prompts.push(request.prompt);
            const reply = replies[prompts.length - 1];
            return { kill() {}, promise: Promise.resolve(reply) };
        }, ...options,
    });
    return { ...runner, prompts, progress };
}

for (const invalid of ['Here is the walkthrough without JSON.', '{"summary":', '[]', 'true', '"text"', 'null', '{}', '{"steps":"wrong type"}']) {
    test(`trace repairs an invalid object response: ${invalid}`, async () => {
        const runner = setup([
            { text: '{"intent":"description","title":"Checkout"}', cost: 1, turns: 1, tokens: 10 },
            { text: invalid, cost: 2, turns: 2, tokens: 20 },
            { text: '{"intent":"description","title":"Checkout","summary":"Findings","steps":[],"edges":[],"gaps":""}', cost: 3, turns: 3, tokens: 30 },
        ]);
        const result = await runner.promise;
        assert.equal(result.trace.title, 'Checkout');
        assert.equal(result.trace.intent, 'description');
        assert.equal(result.cost, 6);
        assert.equal(result.turns, 6);
        assert.equal(result.tokens, 60);
        assert.equal(runner.prompts.length, 3);
        assert.ok(runner.prompts[2].startsWith(runner.prompts[1]));
        assert.ok(runner.prompts[2].includes(JSON.stringify(invalid)));
        assert.deepEqual(runner.progress, ['Repairing trace response format']);
    });
}

test('trace stops retrying after one unsuccessful repair', async () => {
    const runner = setup([{ text: '{}' }, { text: 'bad' }, { text: 'still bad' }]);
    await assert.rejects(runner.promise, { code: 'schema' });
    assert.equal(runner.prompts.length, 3);
});

test('valid trace JSON needs no repair', async () => {
    const runner = setup([{ text: '{}' }, { text: '```json\n{"intent":"description","title":"Checkout","summary":"Done","steps":[],"edges":[],"gaps":""}\n```' }]);
    assert.equal((await runner.promise).trace.summary, 'Done');
    assert.equal(runner.prompts.length, 2);
    assert.deepEqual(runner.progress, []);
});

test('cancellation prevents starting a format repair', async () => {
    let finish;
    const runner = setup([], { run: () => ({ kill() {}, promise: new Promise(resolve => { finish = resolve; }) }) });
    await new Promise(resolve => setImmediate(resolve));
    finish({ text: '{}' });
    await new Promise(resolve => setImmediate(resolve));
    runner.kill();
    finish({ text: 'bad' });
    await assert.rejects(runner.promise, { code: 'stopped' });
});

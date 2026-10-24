import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_CONTEXT, traceContext } from '../lib/trace-context.mjs';
import { withDefaults } from '../lib/config.mjs';
import { runTrace } from '../lib/trace-run.mjs';

test('prior context is bounded, allowlisted and valid even with escaped or malformed input', () => {
    for (const input of [null, undefined, [], 'bad']) assert.equal(traceContext(input), null);
    const context = traceContext({ prompt: '\u0000'.repeat(4000), summary: 's'.repeat(9000),
        steps: Array.from({ length: 100 }, (_, i) => ({ id: `n${i}`, note: 'n'.repeat(4000) })),
        refs: [{ path: true }, { path: '.env' }, { path: '../secret' }, { path: 'src/a.mjs', start: 1, end: 8 }],
        plan: { secret: 'plan' }, previousTrace: { secret: 'history' }, used: { secret: 'usage' },
        flow: { nodes: Array.from({ length: 100 }, () => ({ id: 'f', detail: 'x'.repeat(9000) })) },
    }, { flow: true });
    assert.ok(JSON.stringify(context).length <= MAX_CONTEXT);
    assert.equal(context.omitted, true);
    assert.equal(context.refs.length, 1);
    assert.equal(context.refs[0].path, 'src/a.mjs');
    assert.doesNotMatch(JSON.stringify(context), /secret|previousTrace/);
});

test('sitemap context resolves old indexes without retaining its base and only includes requested diagrams', () => {
    const previous = { prompt: 'Old', flow: { nodes: [{ id: 'f', label: 'Start' }] }, sitemap: {
        base: { navigation: [{ from: 'a', to: 'b', label: 'Next' }], screens: [{ id: 'unrelated' }] },
        navigation: [0], changes: { navigation: [{ index: 0, status: 'removed' }] },
    } };
    assert.equal(traceContext(previous).flow, undefined);
    assert.equal(traceContext(previous).sitemap, undefined);
    const context = traceContext(previous, { sitemap: {} });
    assert.deepEqual(context.sitemap.navigation, [{ from: 'a', to: 'b', label: 'Next' }]);
    assert.equal(context.sitemap.changes[0].from, 'a');
    assert.doesNotMatch(JSON.stringify(context), /unrelated|"base"/);
});

test('revision routes only the new question and gives the main runner current map plus prior findings', async () => {
    const prompts = [];
    const selection = { agent: { id: 'command', models: [], efforts: [] }, model: '', effort: '', label: 'Test' };
    const runner = runTrace({ root: '.', config: withDefaults({}),
        map: { nodes: [{ id: 'current-node' }], edges: [], groups: [] },
        question: 'How does checkout work?', previousTrace: { prompt: 'Add ancient-feature', intent: 'proposal', summary: 'Old design' },
        selection, resolve: async () => selection, run: (_, options) => {
            prompts.push(options.prompt);
            return { kill() {}, promise: Promise.resolve({ text: JSON.stringify(prompts.length === 1 ? { intent: 'description', title: 'Checkout' } : { intent: 'description', title: 'Checkout', summary: 'Checkout', steps: [], edges: [], gaps: '' }) }) };
        },
    });
    const result = await runner.promise;
    assert.equal(result.trace.intent, 'description');
    assert.doesNotMatch(prompts[0], /ancient-feature/);
    assert.match(prompts[1], /ancient-feature/);
    assert.match(prompts[1], /current-node/);
    assert.match(prompts[1], /verify references against current code/);
    assert.match(prompts[1], /PROCESS\nHow does checkout work\?$/);
});

for (const classifierFails of [false, true]) {
    test(`title is emitted before the main response, including classifier fallback=${classifierFails}`, async () => {
        const selection = { agent: { id: 'command', models: [], efforts: [] }, model: '', effort: '', label: 'Test' };
        let finish, title;
        let calls = 0;
        const runner = runTrace({ root: '.', config: withDefaults({}), question: 'How does checkout work?',
            map: { nodes: [], groups: [], edges: [] }, selection, resolve: async () => selection,
            onTitle: value => { title = value; },
            run: () => {
                calls++;
                return { kill() {}, promise: calls === 1
                    ? classifierFails ? Promise.reject(new Error('Unavailable')) : Promise.resolve({ text: '{"intent":"description","title":"Checkout process"}' })
                    : new Promise(resolve => { finish = resolve; }) };
            },
        });
        // Allow classification and main-run startup to finish without resolving the main response.
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(calls, 2);
        assert.equal(title, classifierFails ? 'How does checkout work?' : 'Checkout process');
        finish({ text: JSON.stringify({ intent: 'description', title: 'Final title', summary: 'Checkout', steps: [], edges: [], gaps: '' }) });
        assert.equal((await runner.promise).trace.title, 'Final title');
    });
}

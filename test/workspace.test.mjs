import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { normalizeFlow } from '../lib/flow.mjs';
import { traceOutputs } from '../lib/trace-outputs.mjs';

const html = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]).join('\n');
const between = (start, end) => script.slice(script.indexOf(start), script.indexOf(end, script.indexOf(start)));
const flow = { nodes: [{ id: 'start', type: 'start', label: 'Start', step: 1 }, { id: 'end', type: 'end', label: 'Done' }], edges: [{ from: 'start', to: 'end' }] };
const raw = { title: 'Checkout', steps: [{ id: 'checkout', note: 'Place the order' }], refs: [] };

/** Run the actual page's serialization and creation code without a browser or an AI tool. */
function browserContext({ architecture = true, flowchart = true, result = raw, fail, workspace = 'architecture' } = {}) {
    const elements = Object.fromEntries(['prompt', 'witharchitecture', 'withflow', 'run', 'stop', 'status', 'composer', 'new-trace'].map(id => [id, {
        value: id === 'prompt' ? 'How does checkout work?' : '',
        checked: id === 'witharchitecture' ? architecture : flowchart,
        setAttribute() {},
    }]));
    const calls = { requests: [], saved: [], selected: [] };
    const context = vm.createContext({
        $: id => elements[id], byId: { checkout: { title: 'Checkout' } }, edgePairs: new Set(),
        FLOW: { normalizeFlow }, OUTPUTS: { traceOutputs },
        AbortController, TextDecoder, Date, setInterval: () => 1, clearInterval() {},
        setTimeout: () => 1, clearTimeout() {}, REPO: { ai: true },
        workspace, currentPick: () => ({}), pickLabel: () => 'Test agent', spend: () => '',
        btoa: value => Buffer.from(value, 'binary').toString('base64'),
        atob: value => Buffer.from(value, 'base64').toString('binary'),
        runStream: async (url, opts) => {
            calls.requests.push({ url, body: JSON.parse(opts.body) });
            if (fail) throw fail;
            return { trace: result };
        },
        keepTrace: async (trace, origin) => calls.saved.push({ trace, origin }),
    });
    vm.runInContext([
        between('function cleanRefs(', 'let preTraceGroups='),
        between('function encodeTrace(', '$(' + '"importbtn").onclick='),
        between('let ctl=null, timer=0;', '/* ---------- AI tools:'),
        'globalThis.page={normalizeTrace,plain,encodeTrace,decodeTrace,runTrace};',
    ].join('\n'), context);
    return { context, page: context.page, elements, calls };
}

test('legacy traces infer outputs; explicit choices do not expose supporting architecture', () => {
    assert.deepEqual(traceOutputs(raw), { architecture: true, flowchart: false });
    assert.deepEqual(traceOutputs({ ...raw, flow }), { architecture: true, flowchart: true });
    assert.deepEqual(traceOutputs({ ...raw, flow, outputs: { architecture: false, flowchart: true } }), { architecture: false, flowchart: true });
    assert.deepEqual(traceOutputs({ ...raw, outputs: { architecture: false, flowchart: true } }), { architecture: false, flowchart: false });
});

test('page sharing and normalization preserve output choices, code links, and pending retries', () => {
    const { page } = browserContext();
    const input = { ...raw, title: 'Checkout \u2192 confirmation', flow, outputs: { architecture: false, flowchart: true } };
    const restored = page.decodeTrace(page.encodeTrace(page.normalizeTrace(input)));
    assert.equal(restored.title, input.title);
    assert.deepEqual({ ...restored.outputs }, input.outputs);
    assert.equal(restored.flow.nodes[0].step, 1);
    const pending = page.decodeTrace(page.encodeTrace(page.normalizeTrace({ ...raw, pendingFlow: true, outputs: { architecture: false, flowchart: false } })));
    assert.equal(pending.pendingFlow, true);
    assert.equal(page.normalizeTrace(raw).outputs.architecture, true);
});

for (const [architecture, flowchart] of [[true, false], [false, true], [true, true]]) {
    test(`creation saves requested outputs: architecture=${architecture}, flowchart=${flowchart}`, async () => {
        const { page, calls, elements } = browserContext({ architecture, flowchart, result: { ...raw, ...(flowchart ? { flow } : {}) }, workspace: 'flowchart' });
        await page.runTrace();
        assert.equal(calls.requests.length, 1);
        assert.equal(calls.requests[0].body.flow, flowchart);
        assert.equal(calls.saved.length, 1);
        assert.deepEqual({ ...calls.saved[0].trace.outputs }, { architecture, flowchart });
        assert.equal(calls.saved[0].origin, 'flowchart');
        assert.equal(elements.prompt.value, '');
        assert.equal(elements.stop.hidden, true);
        assert.equal(elements.run.disabled, false);
    });
}

test('no output selection prevents generation and retains the prompt', async () => {
    const { page, calls, elements } = browserContext({ architecture: false, flowchart: false });
    await page.runTrace();
    assert.equal(calls.requests.length, 0);
    assert.match(elements.status.textContent, /Select Code architecture/);
    assert.ok(elements.prompt.value);
});

test('missing flowchart preserves supporting data and a discoverable retry', async () => {
    const { page, calls, elements } = browserContext({ architecture: false, flowchart: true });
    await page.runTrace();
    const saved = calls.saved[0].trace;
    assert.equal(saved.pendingFlow, true);
    assert.equal(saved.outputs.architecture, false);
    assert.equal(saved.outputs.flowchart, false);
    assert.equal(saved.steps.length, 1);
    assert.match(elements.status.textContent, /retry/);
});

test('cancellation retains prompt, saves nothing, and restores controls', async () => {
    const { page, calls, elements } = browserContext({ fail: Object.assign(new Error('Aborted'), { name: 'AbortError' }) });
    await page.runTrace();
    assert.equal(calls.saved.length, 0);
    assert.ok(elements.prompt.value);
    assert.equal(elements.status.textContent, 'Stopped.');
    assert.equal(elements.stop.hidden, true);
    assert.equal(elements.run.disabled, false);
});

test('adding an output updates the existing saved trace; failure retains retryable changes', async () => {
    const { context, calls } = browserContext();
    context.store = { temp: null };
    context.api = async (url, opts) => { calls.requests.push({ url, body: JSON.parse(opts.body), method: opts.method }); return { ok: true }; };
    context.loadSaved = async () => {};
    context.renderSaved = () => {};
    vm.runInContext(between('async function saveExisting(', 'async function loadSaved('), context);
    const trace = { ...raw, _doc: 'existing-id', createdAt: 123, flow, outputs: { architecture: true, flowchart: true } };
    await context.saveExisting(trace);
    assert.equal(calls.requests[0].url, '/api/traces/existing-id');
    assert.equal(calls.requests[0].method, 'PUT');
    assert.equal(calls.requests[0].body.createdAt, 123);
    context.api = async () => ({ ok: false });
    await context.saveExisting(trace);
    assert.equal(context.store.temp, trace);
    context.api = async () => ({ ok: true });
    await context.saveExisting(trace);
    assert.equal(context.store.temp, null);
});

test('page script parses and DOM ids remain unique', () => {
    new vm.Script(script);
    const ids = [...html.split('<script>')[0].matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(new Set(ids).size, ids.length);
});

for (const [architecture, flowchart, preferred, expected] of [
    [true, false, 'flowchart', 'architecture'],
    [false, true, 'architecture', 'flowchart'],
    [true, true, 'architecture', 'architecture'],
    [true, true, 'flowchart', 'flowchart'],
]) {
    test(`saved output opens ${expected} for choices ${architecture}/${flowchart} from ${preferred}`, async () => {
        const { context, page, calls } = browserContext();
        context.store = { temp: null };
        context.api = async () => ({ ok: true, json: async () => ({ key: 'saved-id' }) });
        context.loadSaved = async () => {};
        context.setTrace = trace => calls.selected.push({ trace, workspace: 'architecture' });
        context.showWorkspace = workspace => calls.selected.push({ workspace });
        context.openFlow = trace => calls.selected.push({ trace, workspace: 'flowchart' });
        vm.runInContext(between('async function keepTrace(', 'async function removeTrace('), context);
        const trace = page.normalizeTrace({ ...raw, ...(flowchart ? { flow } : {}), outputs: { architecture, flowchart } });
        await context.keepTrace(trace, preferred);
        assert.equal(calls.selected.at(-1).workspace, expected);
        assert.equal(trace._doc, 'saved-id');
    });
}

test('failed initial save keeps the selected flowchart available and can be retried', async () => {
    const { context, page, calls } = browserContext();
    context.store = { temp: null };
    context.api = async () => ({ ok: false });
    context.loadSaved = async () => {};
    context.setTrace = () => {};
    context.showWorkspace = () => {};
    context.openFlow = trace => calls.selected.push(trace);
    vm.runInContext(between('async function keepTrace(', 'async function removeTrace('), context);
    const trace = page.normalizeTrace({ ...raw, flow, outputs: { architecture: false, flowchart: true } });
    await context.keepTrace(trace);
    assert.equal(context.store.temp, trace);
    assert.equal(calls.selected[0], trace);
    context.api = async () => ({ ok: true, json: async () => ({ key: 'retry-id' }) });
    await context.keepTrace(trace);
    assert.equal(context.store.temp, null);
    assert.equal(trace._doc, 'retry-id');
});

test('saved trace cards keep all traces visible with title, prompt, and per-trace output buttons', async () => {
    const { context, calls } = browserContext();
    const element = tag => ({
        tag, children: [], attributes: {},
        appendChild(child) { this.children.push(child); },
        setAttribute(name, value) { this.attributes[name] = value; },
        set innerHTML(value) { this.children = []; },
    });
    const list = element('ul');
    const count = element('span');
    const empty = element('p');
    context.$ = id => ({ 'trace-list': list, savedcount: count, 'saved-empty': empty })[id];
    context.document = { createElement: element };
    context.AI_BOOT = { available: false };
    context.trace = null;
    context.fl = { t: null };
    context.inspector = {};
    context.store = { temp: null, items: [
        { ...raw, key: 'architecture-id', prompt: 'How does <checkout> work?', outputs: { architecture: true, flowchart: false } },
        { ...raw, key: 'flowchart-id', prompt: 'What are the outcomes?', flow, outputs: { architecture: false, flowchart: true } },
    ] };
    context.openFlow = trace => calls.selected.push({ trace, workspace: 'flowchart' });
    context.setTrace = trace => calls.selected.push({ trace, workspace: 'architecture' });
    context.showWorkspace = workspace => calls.selected.push({ workspace });
    context.saveExisting = async trace => calls.saved.push(trace);
    vm.runInContext(between('function renderSaved(', 'function renderContext('), context);
    for (const workspace of ['architecture', 'flowchart']) {
        context.workspace = workspace;
        context.renderSaved();
        assert.equal(list.children.length, 2, 'the library is independent of the active output');
        assert.equal(list.children[0].children[0].textContent, raw.title);
        assert.equal(list.children[0].children[1].textContent, 'How does <checkout> work?');
        const buttons = list.children[0].children[2].children;
        assert.deepEqual(buttons.map(button => button.textContent), ['Architecture', 'Flowchart']);
        assert.equal(buttons[1].disabled, true, 'missing flow needs an AI tool');
    }
    await list.children[1].children[2].children[1].onclick();
    assert.equal(calls.selected.at(-1).trace._doc, 'flowchart-id');
    await list.children[1].children[2].children[0].onclick();
    assert.equal(calls.saved[0]._doc, 'flowchart-id', 'adding architecture retains the same trace');
    assert.equal(calls.saved[0].outputs.architecture, true);
    assert.equal(calls.selected.at(-1).workspace, 'architecture');
});

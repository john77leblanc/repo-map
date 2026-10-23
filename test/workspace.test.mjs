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

test('sidebar switches from trace library to expanded trace information and output tabs', async () => {
    const { context, calls, page } = browserContext();
    const element = tag => ({
        tag, children: [], attributes: {}, hidden: true,
        appendChild(child) { this.children.push(child); },
        setAttribute(name, value) { this.attributes[name] = value; },
        set innerHTML(value) { this.children = []; },
        focus() {}, click() { return this.onclick(); },
    });
    const ids = ['trace-list', 'savedcount', 'saved-empty', 'sidebar-home', 'sidebar-trace', 'trace-back', 'trace-title', 'trace-prompt', 'trace-architecture', 'trace-flowchart', 'trace-walkthrough', 'trace-flow-details', 'tab-map'];
    const elements = Object.fromEntries(ids.map(id => [id, element('div')]));
    const list = elements['trace-list'];
    context.$ = id => elements[id];
    context.document = { createElement: element, querySelector: () => ({ scrollTop: 0 }) };
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
    context.traceBody = () => element('div');
    vm.runInContext(between('function renderSaved(', 'async function saveExisting('), context);
    context.renderSaved();
    assert.equal(elements['sidebar-home'].hidden, false);
    assert.equal(elements['tab-map'].hidden, false);
    assert.equal(elements['trace-back'].hidden, true);
    assert.equal(elements['sidebar-trace'].hidden, true);
    assert.equal(list.children.length, 2);
    assert.equal(list.children[0].children[0].children[0].textContent, raw.title);
    assert.equal(list.children[0].children[0].children[1].textContent, 'How does <checkout> work?');
    await list.children[1].children[0].onclick();
    assert.equal(calls.selected.at(-1).trace._doc, 'flowchart-id');
    const active = page.normalizeTrace(context.store.items[1]);active._doc = 'flowchart-id';
    context.trace = active;context.fl.t = active;context.workspace = 'flowchart';
    context.renderSaved();
    assert.equal(elements['sidebar-home'].hidden, true);
    assert.equal(elements['tab-map'].hidden, true);
    assert.equal(elements['trace-back'].hidden, false);
    assert.equal(elements['sidebar-trace'].hidden, false);
    assert.equal(elements['trace-title'].textContent, raw.title);
    assert.equal(elements['trace-prompt'].textContent, 'What are the outcomes?');
    assert.equal(elements['trace-flowchart'].attributes['aria-selected'], 'true');
    assert.equal(elements['trace-architecture'].attributes['aria-selected'], 'false');
    assert.equal(elements['trace-walkthrough'].children.length, 1);
    assert.notEqual(elements['trace-walkthrough'].children[0].tag, 'details');
    assert.equal(elements['trace-flow-details'].hidden, false);
    await elements['trace-architecture'].onclick();
    assert.equal(calls.saved[0]._doc, 'flowchart-id');
    assert.equal(calls.saved[0].outputs.architecture, true);
    context.workspace = 'architecture';context.renderTraceSidebar(active);
    assert.equal(elements['trace-flow-details'].hidden, true);
    const selectedCount = calls.selected.length;
    await elements['trace-architecture'].onclick();
    assert.equal(calls.selected.length, selectedCount, 'clicking an active tab keeps it selected');
    context.trace = null;context.renderSaved();
    assert.equal(elements['sidebar-home'].hidden, false);
    assert.equal(elements['tab-map'].hidden, false);
    assert.equal(elements['sidebar-trace'].hidden, true);
});

test('clearing a trace restores the whole map without deleting saved data', () => {
    const { context, calls } = browserContext();
    let removedBadge = false;
    let removedHighlights = false;
    context.document = {
        querySelectorAll: selector => selector === '.stepn'
            ? [{ remove() { removedBadge = true; } }]
            : [{ classList: { remove() { removedHighlights = true; } } }],
    };
    context.groupEl = { first: { open: false }, second: { open: true } };
    context.preTraceGroups = { first: true, second: false };
    context.trace = raw;
    context.pinned = 'checkout';
    context.hover = 'checkout';
    context.inspector = { hidden: false };
    context.q = { value: 'checkout' };
    context.nodeEl = { checkout: { classList: { contains: () => true } } };
    context.setOpen = (id, open) => calls.selected.push({ id, open });
    context.renderSaved = () => {};
    context.redraw = () => {};
    context.doSearch = () => {};
    context.showWorkspace = name => { context.workspace = name; };
    context.store = { items: [{ ...raw, key: 'saved-trace' }] };
    vm.runInContext([
        between('function setTrace(', 'function reveal('),
        between('function clearTrace(', 'document.addEventListener("keydown"'),
    ].join('\n'), context);
    context.clearTrace();
    assert.equal(context.trace, null);
    assert.equal(context.pinned, null);
    assert.equal(context.hover, null);
    assert.equal(context.preTraceGroups, null);
    assert.equal(context.groupEl.first.open, true);
    assert.equal(context.groupEl.second.open, false);
    assert.equal(context.inspector.hidden, true);
    assert.equal(context.q.value, '');
    assert.equal(context.workspace, 'architecture');
    assert.equal(removedBadge, true);
    assert.equal(removedHighlights, true);
    assert.equal(context.store.items.length, 1);
    assert.equal(calls.requests.length, 0);
});

test('default flowchart zoom adds two plus steps while Fit preserves the fitted scale', () => {
    const scales = [];
    const context = vm.createContext({
        fl: { layout: { width: 500, height: 300 } },
        $: () => ({ clientWidth: 1024, clientHeight: 768 }),
        setScale: value => scales.push(value),
    });
    vm.runInContext(between('function fitFlow(', 'function pickFlow('), context);
    context.fitFlow(1.2 ** 2);
    assert.equal(scales.at(-1), 1.44);
    context.fitFlow();
    assert.equal(scales.at(-1), 1);
    context.fl.layout = { width: 2000, height: 1200 };
    context.fitFlow(1.2 ** 2);
    assert.equal(scales.at(-1), 0.65 * 1.44);
});

test('Settings notifications can be dismissed across reloads and reappear for new issues', () => {
    const storage = new Map();
    function noticeContext() {
        const elements = Object.fromEntries(['tab-map', 'tab-map-dot', 'ms-dismiss'].map(id => [id, {
            setAttribute(name, value) { this[name] = value; },
        }]));
        const context = vm.createContext({
            $: id => elements[id], NS: 'test-repo:',
            mapSt: { state: 'unrecorded', docs: { linked: true } },
            localStorage: {
                getItem: key => storage.get(key),
                setItem: (key, value) => storage.set(key, value),
                removeItem: key => storage.delete(key),
            },
        });
        vm.runInContext(between('function mapNoticeKey(', '/* map jobs:'), context);
        return { context, elements };
    }
    const { context, elements } = noticeContext();
    context.renderMapNotice();
    assert.equal(elements['tab-map-dot'].hidden, false);
    assert.match(elements['tab-map']['aria-label'], /needs attention/);
    elements['ms-dismiss'].onclick();
    assert.equal(elements['tab-map-dot'].hidden, true);
    assert.equal(elements['ms-dismiss'].hidden, true);
    assert.equal(context.mapSt.state, 'unrecorded', 'dismissal does not alter the underlying map');
    const reloaded = noticeContext();reloaded.context.renderMapNotice();
    assert.equal(reloaded.elements['tab-map-dot'].hidden, true);
    context.mapSt = { state: 'stale', commit: 'abc', changed: 1, files: ['a.mjs'], docs: { linked: true } };
    context.renderMapNotice();
    assert.equal(elements['tab-map-dot'].hidden, false);
    context.dismissMapNotice();
    context.mapSt.files = ['b.mjs'];context.renderMapNotice();
    assert.equal(elements['tab-map-dot'].hidden, false, 'different changes notify again');
    context.mapSt = { state: 'current', docs: { linked: true } };context.renderMapNotice();
    assert.equal(elements['tab-map-dot'].hidden, true);
    assert.equal(storage.size, 0, 'resolved issues clear the dismissal');
    context.mapSt.docs = { linked: true, changed: 1, files: ['README.md'] };context.renderMapNotice();
    assert.equal(elements['tab-map-dot'].hidden, false, 'changed documentation also notifies');
});

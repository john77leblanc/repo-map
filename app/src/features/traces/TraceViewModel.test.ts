import { describe, expect, it, vi } from 'vitest';
import { autorun, runInAction } from 'mobx';
import { TraceViewModel } from './TraceViewModel';
import { decodeTrace, encodeTrace, normalizeTrace } from '../../models/trace';
import { fixture, flow, raw } from './testFixtures';
describe('trace normalization and persistence', () => {
    it('preserves sharing output choices, code links, proposals, plans and flow step meaning', () => {
        const { repo } = fixture();
        const t = normalizeTrace(
            {
                ...raw,
                intent: 'proposal',
                proposal: {
                    nodes: [
                        {
                            id: 'proposal:coupon',
                            status: 'new',
                            group: 'shop',
                            title: 'Coupon',
                            suggestedPath: 'coupon.mjs',
                        },
                    ],
                    edges: [{ from: 'checkout', to: 'proposal:coupon', status: 'new' }],
                },
                plan: {
                    tasks: [
                        { title: 'Validate', detail: 'Check expiry', files: ['new: coupon.mjs'] },
                    ],
                },
                steps: [{ id: 'missing' }, ...raw.steps],
                refs: [{ step: 'checkout', path: 'checkout.mjs', start: 2, end: 1 }],
                flow: { ...flow, nodes: [{ ...flow.nodes[0], step: 2 }, flow.nodes[1]] },
                outputs: { architecture: false, flowchart: true },
            },
            repo.map
        );
        const restored = decodeTrace(encodeTrace(t).replace('rmap1:', 'msmap1:'), repo.map);
        expect(restored.outputs).toEqual({ architecture: false, flowchart: true });
        expect(restored.flow?.nodes[0].step).toBe(1);
        expect(restored.refs[0].end).toBe(2);
        expect(restored.proposal?.nodes[0].suggestedPath).toBe('coupon.mjs');
        expect(restored.plan?.tasks[0].detail).toBe('Check expiry');
        expect(restored.pairs?.has('checkout|proposal:coupon')).toBe(true);
        expect(
            normalizeTrace({ ...raw, plan: t.plan, proposal: t.proposal }, repo.map).plan
        ).toBeNull();
    });
    it('removes invalid flow references and infers legacy outputs', () => {
        const { repo } = fixture();
        const t = normalizeTrace(
            { ...raw, steps: [{ id: 'missing' }, ...raw.steps], flow },
            repo.map
        );
        expect(t.flow?.nodes[0].step).toBeUndefined();
        expect(t.outputs).toEqual({ architecture: true, flowchart: true });
    });
    it('restores and writes raw output preferences', async () => {
        const { deps, storage, repo } = fixture();
        storage.set(repo.namespace + 'witharchitecture', '0');
        const vm = new TraceViewModel(deps);
        await vm.init();
        expect(vm.architecture).toBe(false);
        expect(vm.flowchart).toBe(true);
        vm.setOutput('flowchart', false);
        expect(storage.get(repo.namespace + 'withflow')).toBe('0');
        vm.dispose();
    });
    for (const [architecture, flowchart] of [
        [true, false],
        [false, true],
        [true, true],
    ])
        it(`creates requested outputs ${architecture}/${flowchart}`, async () => {
            const { deps, services } = fixture();
            vi.mocked(services.api.stream).mockResolvedValue({
                trace: { ...raw, ...(flowchart ? { flow } : {}) },
            });
            const vm = new TraceViewModel(deps);
            vm.setPrompt('Question');
            vm.setOutput('architecture', architecture);
            vm.setOutput('flowchart', flowchart);
            await vm.runTrace();
            expect(services.api.stream).toHaveBeenCalledWith(
                '/api/trace',
                { prompt: 'Question', flow: flowchart, agent: 'api' },
                expect.any(AbortSignal),
                expect.any(Function),
                expect.any(Function)
            );
            expect(vm.selected?.outputs).toEqual({ architecture, flowchart });
            expect(vm.prompt).toBe('');
            expect(vm.busy).toBe(false);
            expect(deps.onSelect).toHaveBeenCalledWith(
                vm.selected,
                flowchart ? 'flowchart' : 'architecture'
            );
            vm.dispose();
        });
    it('keeps missing flow support and failed saves discoverable', async () => {
        const { deps, services } = fixture();
        vi.mocked(services.api.stream).mockResolvedValue({ trace: raw });
        vi.mocked(services.api.request).mockRejectedValue(new Error('disk'));
        const vm = new TraceViewModel(deps);
        vm.setPrompt('Question');
        vm.setOutput('architecture', false);
        await vm.runTrace();
        expect(vm.selected?.pendingFlow).toBe(true);
        expect(vm.selected?.steps).toHaveLength(1);
        expect(vm.temp).toBe(vm.selected);
        expect(vm.status).toMatch(/retry/);
        vm.dispose();
    });
    it('rejects no outputs and retains prompt', async () => {
        const { deps, services } = fixture();
        const vm = new TraceViewModel(deps);
        vm.setPrompt('Question');
        vm.setOutput('architecture', false);
        vm.setOutput('flowchart', false);
        await vm.runTrace();
        expect(services.api.stream).not.toHaveBeenCalled();
        expect(services.api.request).not.toHaveBeenCalled();
        expect(vm.selected).toBeNull();
        expect(vm.busy).toBe(false);
        expect(vm.prompt).toBe('Question');
        expect(vm.status).toMatch(/Select Code/);
        vm.dispose();
    });
    it('guards late canceled results and ticks elapsed time', async () => {
        vi.useFakeTimers();
        const { deps, services } = fixture();
        let resolve!: (v: unknown) => void;
        vi.mocked(services.api.stream).mockImplementation(
            () =>
                new Promise((r) => {
                    resolve = r;
                }) as never
        );
        const vm = new TraceViewModel(deps);
        vm.setPrompt('Question');
        const pending = vm.runTrace();
        await vi.advanceTimersByTimeAsync(2000);
        expect(vm.status).toMatch(/2s/);
        vm.stop();
        resolve({ trace: raw });
        await pending;
        expect(vm.selected).toBeNull();
        expect(vm.prompt).toBe('Question');
        expect(vm.busy).toBe(false);
        expect(services.api.request).not.toHaveBeenCalled();
        vm.dispose();
        vi.useRealTimers();
    });
    it('observes mutations to selected trace and ignores results after disposal', async () => {
        const { deps, repo, services } = fixture();
        const vm = new TraceViewModel(deps);
        vm.select(normalizeTrace(raw, repo.map));
        const seen: boolean[] = [];
        const stop = autorun(() => seen.push(!!vm.selected?.flow));
        runInAction(() => {
            vm.selected!.flow = flow;
        });
        expect(seen).toEqual([false, true]);
        stop();
        let resolve!: (v: unknown) => void;
        vi.mocked(services.api.stream).mockImplementation(
            () =>
                new Promise((r) => {
                    resolve = r;
                }) as never
        );
        vm.setPrompt('Question');
        const pending = vm.runTrace();
        vm.dispose();
        resolve({ trace: raw });
        await pending;
        expect(services.api.request).not.toHaveBeenCalled();
    });
});
it('preserves pending retry sharing and description edge reversal without reversing proposal direction', () => {
    const { repo } = fixture();
    repo.map.edges = [{ from: 'checkout', to: 'db', type: 'http' }];
    repo.map.nodes.push({ id: 'db', kind: 'service', group: 'shop' });
    const input = {
        ...raw,
        steps: [{ id: 'db', note: '' }, ...raw.steps],
        edges: [['db', 'checkout']],
        pendingFlow: true,
        outputs: { architecture: false, flowchart: false },
    };
    const restored = decodeTrace(encodeTrace(normalizeTrace(input, repo.map)), repo.map);
    expect(restored.pendingFlow).toBe(true);
    expect(restored.outputs).toEqual({ architecture: false, flowchart: false });
    expect(restored.edges).toEqual([['checkout', 'db']]);
    const proposal = normalizeTrace({ ...input, intent: 'proposal' }, repo.map);
    expect(proposal.edges).toEqual([]);
});
it('keeps newest saved-list response and ignores disposed results', async () => {
    const { deps, services } = fixture();
    const resolves: ((value: unknown) => void)[] = [];
    vi.mocked(services.api.get).mockImplementation(
        () => new Promise((resolve) => resolves.push(resolve)) as never
    );
    const vm = new TraceViewModel(deps);
    const first = vm.loadSaved(),
        second = vm.loadSaved();
    resolves[1]({ traces: [{ ...raw, key: 'new' }] });
    await second;
    resolves[0]({ traces: [{ ...raw, key: 'old' }] });
    await first;
    expect(vm.items[0].key).toBe('new');
    const last = vm.loadSaved();
    vm.dispose();
    resolves[2]({ traces: [] });
    await last;
    expect(vm.items[0].key).toBe('new');
});
it('passes observable trace to flow integration and retains updated selection', async () => {
    const { deps, repo } = fixture();
    const vm = new TraceViewModel(deps);
    const t = normalizeTrace(raw, repo.map);
    deps.onRequestFlow = async (trace) => {
        vm.select(trace, 'flowchart');
        runInAction(() => {
            trace.flow = flow;
            trace.outputs.flowchart = true;
        });
    };
    await vm.openSavedOutput(t, 'flowchart');
    expect(vm.selected?.flow?.nodes).toHaveLength(2);
    expect(vm.selected?.outputs.flowchart).toBe(true);
    vm.dispose();
});
it('restores canceled controls when stream rejects and saves nothing', async () => {
    const { deps, services } = fixture();
    vi.mocked(services.api.stream).mockImplementation(
        (_url, _body, signal) =>
            new Promise((_resolve, reject) =>
                signal.addEventListener('abort', () =>
                    reject(new DOMException('Stopped', 'AbortError'))
                )
            )
    );
    const vm = new TraceViewModel(deps);
    vm.setPrompt('Question');
    const pending = vm.runTrace();
    vm.stop();
    await pending;
    expect(vm.status).toBe('Stopped.');
    expect(vm.prompt).toBe('Question');
    expect(vm.busy).toBe(false);
    expect(services.api.request).not.toHaveBeenCalled();
    vm.dispose();
});

// Deferred responses exercise navigation and saving independently of AI latency.
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

it.each([
    [true, false, 'architecture', 'architecture'],
    [true, false, 'flowchart', 'architecture'],
    [false, true, 'architecture', 'flowchart'],
    [false, true, 'flowchart', 'flowchart'],
    [true, true, 'architecture', 'architecture'],
    [true, true, 'flowchart', 'flowchart'],
] as const)(
    'opens saved outputs %s/%s from %s in %s',
    async (architecture, flowchart, preferred, expected) => {
        const { deps, repo, services } = fixture();
        const vm = new TraceViewModel(deps);
        await vm.keepTrace(
            normalizeTrace(
                { ...raw, ...(flowchart ? { flow } : {}), outputs: { architecture, flowchart } },
                repo.map
            ),
            preferred
        );
        expect(deps.onSelect).toHaveBeenCalledWith(vm.selected, expected);
        expect(vm.selected?._doc).toBe('saved');
        const options = vi.mocked(services.api.request).mock.calls[0][1]!;
        expect(options.method).toBe('POST');
        expect(JSON.parse(String(options.body)).outputs).toEqual({ architecture, flowchart });
        vm.dispose();
    }
);

it('retries an initial failed flowchart save and persists later changes with PUT', async () => {
    const { deps, repo, services } = fixture();
    vi.mocked(services.api.request).mockRejectedValueOnce(new Error('disk unavailable'));
    const vm = new TraceViewModel(deps);
    await vm.keepTrace(
        normalizeTrace(
            { ...raw, flow, outputs: { architecture: false, flowchart: true } },
            repo.map
        )
    );
    const selected = vm.selected!;
    const createdAt = selected.createdAt;
    expect(vm.temp).toBe(selected);
    expect(vm.rows).toEqual([selected]);
    expect(deps.onSelect).toHaveBeenLastCalledWith(selected, 'flowchart');
    expect(selected._doc).toBeUndefined();
    vi.mocked(services.api.request).mockResolvedValueOnce({ key: 'retry-id' });
    vi.mocked(services.api.get).mockResolvedValueOnce({
        traces: [{ ...raw, flow, outputs: selected.outputs, key: 'retry-id', createdAt }],
    });
    await vm.saveExisting(selected);
    expect(vm.temp).toBeNull();
    expect(selected._doc).toBe('retry-id');
    expect(vm.rows).toHaveLength(1);
    expect(vm.rows[0].key).toBe('retry-id');
    expect(vm.selected).toBe(selected);
    expect(selected.createdAt).toBe(createdAt);
    runInAction(() => {
        selected.gaps = 'Updated explanation';
    });
    await vm.saveExisting(selected);
    const [url, options] = vi.mocked(services.api.request).mock.calls[2];
    expect(url).toBe('/api/traces/retry-id');
    expect(options?.method).toBe('PUT');
    expect(JSON.parse(String(options?.body))).toMatchObject({
        createdAt,
        gaps: 'Updated explanation',
        outputs: { architecture: false, flowchart: true },
    });
    vm.dispose();
});

it('keeps a failed update available and clears the temporary entry after a successful PUT retry', async () => {
    const { deps, repo, services } = fixture();
    const vm = new TraceViewModel(deps);
    vm.select(normalizeTrace(raw, repo.map));
    runInAction(() => {
        vm.selected!._doc = 'existing';
    });
    const selected = vm.selected!;
    vi.mocked(services.api.request).mockRejectedValueOnce(new Error('disk'));
    await vm.saveExisting(selected);
    expect(vm.temp).toBe(selected);
    expect(vm.status).toMatch(/Retry saving/);
    await vm.saveExisting(selected);
    expect(vm.temp).toBeNull();
    expect(vm.selected).toBe(selected);
    expect(services.api.request).toHaveBeenLastCalledWith(
        '/api/traces/existing',
        expect.objectContaining({ method: 'PUT' })
    );
    vm.dispose();
});

it.each([
    [{ cost: 0.123 }, '$0.12'],
    [{ cost: 0.001 }, '<$0.01'],
    [{ tokens: 1234 }, '1,234 tokens'],
    [{ spend: 'local inference' }, 'local inference'],
])('stops the elapsed ticker before a slow save and retains usage %j', async (usage, label) => {
    vi.useFakeTimers();
    const { deps, services } = fixture();
    const answer = deferred<unknown>(),
        save = deferred<unknown>();
    vi.mocked(services.api.stream).mockImplementation(() => answer.promise as never);
    vi.mocked(services.api.request).mockImplementation(() => save.promise as never);
    const vm = new TraceViewModel(deps);
    try {
        vm.setPrompt('Question');
        const pending = vm.runTrace();
        await vi.advanceTimersByTimeAsync(2000);
        expect(vm.status).toMatch(/2s/);
        answer.resolve({ trace: { ...raw, flow }, ...usage });
        await vi.waitFor(() => expect(services.api.request).toHaveBeenCalledOnce());
        const completedStatus = vm.status;
        expect(completedStatus).toContain('Done in 2s');
        expect(completedStatus).toContain(label);
        expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(5000);
        expect(vm.status).toBe(completedStatus);
        save.resolve({ key: 'saved' });
        await pending;
        expect(vm.status).toBe(completedStatus);
    } finally {
        vm.dispose();
        vi.useRealTimers();
    }
});

it.each(['back', 'switch'] as const)(
    'a late creation save cannot steal selection after %s',
    async (navigation) => {
        const { deps, repo, services } = fixture();
        const save = deferred<unknown>();
        vi.mocked(services.api.request).mockImplementationOnce(() => save.promise as never);
        const vm = new TraceViewModel(deps);
        vm.select(normalizeTrace({ ...raw, title: 'Previous' }, repo.map));
        const pending = vm.keepTrace(normalizeTrace({ ...raw, title: 'Saving' }, repo.map));
        if (navigation === 'back') vm.clear();
        else
            vm.select(
                normalizeTrace({ ...raw, title: 'Other selection' }, repo.map),
                'architecture'
            );
        const selected = vm.selected;
        vi.mocked(deps.onSelect).mockClear();
        save.resolve({ key: 'saved' });
        await pending;
        expect(vm.selected).toBe(selected);
        expect(deps.onSelect).not.toHaveBeenCalled();
        expect(services.api.get).toHaveBeenCalledWith('/api/traces', expect.any(AbortSignal));
        vm.dispose();
    }
);

it.each(['back', 'switch'] as const)(
    'a late architecture-output save cannot steal selection after %s',
    async (navigation) => {
        const { deps, repo, services } = fixture();
        const save = deferred<unknown>();
        vi.mocked(services.api.request).mockImplementationOnce(() => save.promise as never);
        const vm = new TraceViewModel(deps);
        const trace = normalizeTrace(
            { ...raw, flow, outputs: { architecture: false, flowchart: true } },
            repo.map
        );
        trace._doc = 'flow-only';
        vm.select(trace, 'flowchart');
        const pending = vm.openOutput('architecture');
        if (navigation === 'back') vm.clear();
        else vm.select(normalizeTrace({ ...raw, title: 'Other selection' }, repo.map), 'flowchart');
        const selected = vm.selected;
        vi.mocked(deps.onSelect).mockClear();
        save.resolve({});
        await pending;
        expect(vm.selected).toBe(selected);
        expect(deps.onSelect).not.toHaveBeenCalled();
        expect(
            JSON.parse(String(vi.mocked(services.api.request).mock.calls[0][1]?.body)).outputs
                .architecture
        ).toBe(true);
        vm.dispose();
    }
);

it('remaps retained flow steps without changing their meaning when invalid and duplicate steps are discarded', () => {
    const { repo } = fixture();
    repo.map.nodes.push({ id: 'db', kind: 'service', group: 'shop' });
    const input = {
        ...raw,
        steps: [
            { id: 'missing' },
            ...raw.steps,
            { id: 'checkout', note: 'duplicate' },
            { id: 'db' },
        ],
        flow: {
            nodes: [
                { id: 'start', type: 'start', label: 'Unknown step', step: 1 },
                { id: 'retained', type: 'process', label: 'Checkout', step: 2 },
                { id: 'duplicate', type: 'process', label: 'Checkout again', step: 3 },
                { id: 'end', type: 'end', label: 'Database', step: 4 },
            ],
            edges: [
                { from: 'start', to: 'retained' },
                { from: 'retained', to: 'duplicate' },
                { from: 'duplicate', to: 'end' },
            ],
        },
    };
    const trace = normalizeTrace(input, repo.map);
    expect(trace.steps.map((s) => s.id)).toEqual(['checkout', 'db']);
    expect(trace.flow?.nodes.map((n) => n.step)).toEqual([undefined, 1, 1, 2]);
    expect(decodeTrace(encodeTrace(trace), repo.map).flow?.nodes.map((n) => n.step)).toEqual([
        undefined,
        1,
        1,
        2,
    ]);
});

it('does not reopen a trace when Back happens during the saved-list refresh after persistence', async () => {
    const { deps, repo, services } = fixture();
    const refresh = deferred<unknown>();
    vi.mocked(services.api.get).mockImplementationOnce(() => refresh.promise as never);
    const vm = new TraceViewModel(deps);
    const pending = vm.keepTrace(normalizeTrace(raw, repo.map));
    await vi.waitFor(() => expect(services.api.get).toHaveBeenCalledOnce());
    vm.clear();
    refresh.resolve({ traces: [{ ...raw, key: 'saved' }] });
    await pending;
    expect(vm.selected).toBeNull();
    expect(deps.onSelect).not.toHaveBeenCalled();
    expect(vm.items[0].key).toBe('saved');
    vm.dispose();
});

it('validates unknown trace input and cleans malformed nested steps, refs and agent metadata', () => {
    const { repo } = fixture();
    for (const value of [null, undefined, 'trace', 42, []]) {
        expect(() => normalizeTrace(value, repo.map)).toThrow('no trace');
    }
    expect(() => normalizeTrace({ steps: [null, false, { id: 'missing' }] }, repo.map)).toThrow(
        'no known services'
    );
    const input: unknown = {
        steps: [
            null,
            {
                id: 'checkout',
                note: 123,
                refs: [
                    null,
                    { path: '/checkout.mjs', start: '3', end: '1', why: 42 },
                    { path: '../private' },
                ],
            },
        ],
        edges: [null, 'checkout', {}],
        used: { agent: 123, model: false, label: 'Test' },
    };
    const trace = normalizeTrace(input, repo.map);
    expect(trace.steps).toEqual([{ id: 'checkout', note: '123' }]);
    expect(trace.refs).toEqual([
        { step: 'checkout', path: 'checkout.mjs', start: 3, end: 3, why: '42' },
    ]);
    expect(trace.used).toEqual({ agent: '123', model: '', effort: '', label: 'Test' });
    expect(trace.edges).toEqual([]);
    expect(trace.outputs).toEqual({ architecture: true, flowchart: false });
});

it('serializes only portable trace fields and preserves Unicode through a typed unknown boundary', () => {
    const { repo } = fixture();
    const trace = normalizeTrace(
        { ...raw, title: 'Checkout → confirmation', pendingFlow: true },
        repo.map
    );
    trace._doc = 'local-file';
    trace.key = 'local-key';
    trace.createdAt = 123;
    const serialized: unknown = JSON.parse(atob(encodeTrace(trace).slice('rmap1:'.length)));
    expect(serialized).not.toHaveProperty('pairs');
    expect(serialized).not.toHaveProperty('_doc');
    expect(serialized).not.toHaveProperty('key');
    expect(serialized).not.toHaveProperty('createdAt');
    expect(serialized).not.toHaveProperty('plan');
    expect(decodeTrace(encodeTrace(trace), repo.map).title).toBe('Checkout → confirmation');
    expect(decodeTrace(encodeTrace(trace), repo.map).pendingFlow).toBe(true);
});


describe('editing saved trace prompts', () => {
    function editing() {
        const f = fixture();
        const vm = new TraceViewModel(f.deps);
        const original = normalizeTrace({ ...raw, prompt: 'Original question', flow,
            intent: 'proposal', plan: { tasks: [{ title: 'Old task', detail: 'Old design', files: [] }] } }, f.repo.map);
        original._doc = 'saved-original';
        original.createdAt = 123;
        vm.select(original);
        vm.editPrompt(vm.selected!);
        vm.setPrompt('Revised complete question');
        return { ...f, vm, original };
    }
    it('replaces under the same ID, clears plans and leaves output defaults unchanged', async () => {
        const { vm, services, storage, original } = editing();
        vm.setOutput('flowchart', false);
        expect(storage.size).toBe(0);
        vi.mocked(services.api.stream).mockResolvedValue({ trace: { ...raw, flow } });
        await vm.runTrace();
        expect(services.api.stream).toHaveBeenCalledWith('/api/trace', expect.objectContaining({
            prompt: 'Revised complete question', previousTrace: expect.objectContaining({ prompt: 'Original question' }),
            architecture: true, flow: false,
        }), expect.any(AbortSignal), expect.any(Function));
        const [url, options] = vi.mocked(services.api.request).mock.calls[0];
        expect(url).toBe('/api/traces/saved-original');
        expect(options?.method).toBe('PUT');
        const saved = JSON.parse(String(options?.body));
        expect(saved.createdAt).toBe(123);
        expect(saved.prompt).toBe('Revised complete question');
        expect(saved.plan).toBeUndefined();
        expect(saved.flow).toBeUndefined();
        expect(original.plan?.tasks[0].title).toBe('Old task');
        expect(vm.editing).toBeNull();
        expect(vm.flowchart).toBe(true);
        vm.dispose();
    });
    it('keeps the original and draft for missing outputs and generation errors', async () => {
        const { vm, services, original } = editing();
        vi.mocked(services.api.stream).mockResolvedValue({ trace: raw });
        await vm.runTrace();
        expect(services.api.request).not.toHaveBeenCalled();
        expect(vm.status).toContain('Not all requested outputs');
        expect(vm.editing?.prompt).toBe('Original question');
        expect(vm.prompt).toBe('Revised complete question');
        expect(original.flow).not.toBeNull();
        vi.mocked(services.api.stream).mockRejectedValue(new Error('Agent failed'));
        await vm.runTrace();
        expect(vm.status).toBe('Agent failed');
        expect(services.api.request).not.toHaveBeenCalled();
        vm.dispose();
    });
    it('cancels without saving late results and restores the draft on reopening', async () => {
        const { vm, services } = editing();
        let resolve!: (result: unknown) => void;
        vi.mocked(services.api.stream).mockImplementation(() => new Promise(r => { resolve = r; }));
        const run = vm.runTrace();
        vm.cancelEdit();
        resolve({ trace: { ...raw, flow } });
        await run;
        expect(services.api.request).not.toHaveBeenCalled();
        expect(vm.selected?.prompt).toBe('Original question');
        vm.editPrompt(vm.selected!);
        expect(vm.prompt).toBe('Revised complete question');
        vm.dispose();
    });
    it('retains an unsaved revision for retry while keeping the saved identity', async () => {
        const { vm, services } = editing();
        vi.mocked(services.api.stream).mockResolvedValue({ trace: { ...raw, flow } });
        vi.mocked(services.api.request).mockRejectedValueOnce(new Error('Disk full'));
        await vm.runTrace();
        expect(vm.temp?.prompt).toBe('Revised complete question');
        expect(vm.selected).toBe(vm.temp);
        expect(vm.temp?._doc).toBe('saved-original');
        expect(vm.status).toContain('could not be saved');
        await vm.saveExisting(vm.temp!);
        expect(vi.mocked(services.api.request).mock.calls[1][0]).toBe('/api/traces/saved-original');
        expect(vm.temp).toBeNull();
        vm.dispose();
    });
});


it('accepts a valid no-relevant-screens result when replacing a Sitemap-only trace', async () => {
    const { deps, repo, services } = fixture();
    const base = { version: 1 as const, applicability: 'none' as const, summary: 'No screens',
        applications: [], screens: [], navigation: [], gaps: [] };
    const sitemap = { version: 1, base, applicability: 'none', summary: 'This process has no screen journey.',
        steps: [], navigation: [], changes: { screens: [], navigation: [] }, gaps: [] };
    const { SitemapViewModel } = await import('../sitemap/SitemapViewModel');
    deps.sitemap = new SitemapViewModel({ repo, services });
    deps.sitemap.sitemap = base;
    const vm = new TraceViewModel(deps);
    const original = normalizeTrace({ prompt: 'Old question', steps: [], sitemap,
        outputs: { architecture: false, flowchart: false, sitemap: true } }, repo.map);
    original._doc = 'screen-only-trace';
    vm.editPrompt(original);
    vm.setPrompt('Explain the background process');
    vi.mocked(services.api.stream).mockResolvedValue({ trace: { steps: [], sitemap } });
    await vm.runTrace();
    expect(services.api.request).toHaveBeenCalledWith('/api/traces/screen-only-trace', expect.objectContaining({ method: 'PUT' }));
    expect(vm.selected?.sitemap?.applicability).toBe('none');
    expect(vm.editing).toBeNull();
    vm.dispose();
    deps.sitemap.dispose();
});
it('says Copied! on the copied trace only, for two seconds', async () => {
    vi.useFakeTimers();
    try {
        const { deps, repo } = fixture();
        const vm = new TraceViewModel(deps);
        const a = { ...normalizeTrace(raw, repo.map), _doc: 'a.json' };
        const b = { ...normalizeTrace(raw, repo.map), _doc: 'b.json' };
        await vm.copyCode(a);
        expect(vm.codeCopied(a)).toBe(true);
        expect(vm.codeCopied(b)).toBe(false);
        vi.advanceTimersByTime(2000);
        expect(vm.codeCopied(a)).toBe(false);
        vm.dispose();
    } finally {
        vi.useRealTimers();
    }
});

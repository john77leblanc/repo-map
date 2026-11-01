import { expect, it, vi } from 'vitest';
import { observable } from 'mobx';
import { PlansViewModel, planMarkdown } from './PlansViewModel';
import { fixture, raw } from '../traces/testFixtures';
import { normalizeTrace } from '../../models/trace';
const plan = {
    summary: 'Coupons',
    tasks: [{ title: 'Validate', detail: 'Check expiry', files: ['new: coupons.mjs'] }],
};
it('generates on demand, caches, and retains plan on failed regeneration', async () => {
    const { repo, services } = fixture();
    const saveTrace = vi.fn(async () => {});
    vi.mocked(services.api.stream).mockResolvedValue({ plan });
    const vm = new PlansViewModel({ repo, services, getPick: () => ({}), saveTrace });
    const t = normalizeTrace({ ...raw, intent: 'proposal' }, repo.map);
    await vm.open(t);
    expect(saveTrace).toHaveBeenCalledOnce();
    expect(planMarkdown(t.plan!)).toContain('new: coupons.mjs');
    vm.close();
    await vm.open(t);
    expect(services.api.stream).toHaveBeenCalledOnce();
    const retained = t.plan;
    vi.mocked(services.api.stream).mockRejectedValue(new Error('Temporary failure'));
    await vm.generatePlan();
    expect(t.plan).toBe(retained);
    expect(vm.status).toMatch(/Temporary failure/);
    expect(vm.busy).toBe(false);
    vm.dispose();
});
it('keeps generating after close and reopening resumes the same request', async () => {
    const { repo, services } = fixture();
    const saveTrace = vi.fn(async () => {});
    let resolve!: (v: unknown) => void;
    vi.mocked(services.api.stream).mockImplementation(
        () =>
            new Promise((r) => {
                resolve = r;
            }) as never
    );
    const vm = new PlansViewModel({ repo, services, getPick: () => ({}), saveTrace });
    const t = normalizeTrace({ ...raw, intent: 'proposal' }, repo.map);
    const pending = vm.open(t);
    vm.close();
    expect(vm.isOpen).toBe(false);
    expect(vm.isGenerating(t)).toBe(true);
    // its library row (a separate copy, identified by key) counts too; other traces don't
    t._doc = 'doc-1';
    expect(vm.isGenerating({ ...t, _doc: undefined, key: 'doc-1' })).toBe(true);
    expect(vm.isGenerating({ ...t, _doc: undefined, key: 'doc-2' })).toBe(false);
    await vm.open(t);
    expect(vm.isOpen).toBe(true);
    expect(services.api.stream).toHaveBeenCalledOnce();
    resolve({ plan });
    await pending;
    expect(t.plan?.tasks[0].title).toBe('Validate');
    expect(vm.isGenerating(t)).toBe(false);
    vm.dispose();
});
it('aborts on stop, ignores late completion, and permits retry', async () => {
    const { repo, services } = fixture();
    const saveTrace = vi.fn(async () => {});
    let resolve!: (v: unknown) => void;
    vi.mocked(services.api.stream).mockImplementation(
        () =>
            new Promise((r) => {
                resolve = r;
            }) as never
    );
    const vm = new PlansViewModel({ repo, services, getPick: () => ({}), saveTrace });
    const t = normalizeTrace({ ...raw, intent: 'proposal' }, repo.map);
    const pending = vm.open(t);
    vm.stop();
    resolve({ plan });
    await pending;
    expect(t.plan).toBeNull();
    expect(saveTrace).not.toHaveBeenCalled();
    expect(vm.busy).toBe(false);
    expect(vm.status).toMatch(/Stopped/);
    vi.mocked(services.api.stream).mockResolvedValue({ plan });
    await vm.open(t);
    expect(t.plan?.tasks[0].title).toBe('Validate');
    vm.dispose();
});

it('keeps the replacement plan generation active when a canceled request returns late', async () => {
    const { repo, services } = fixture();
    const saveTrace = vi.fn(async () => {});
    let resolveOld!: (value: unknown) => void, resolveNew!: (value: unknown) => void;
    vi.mocked(services.api.stream)
        .mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    resolveOld = resolve;
                }) as never
        )
        .mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    resolveNew = resolve;
                }) as never
        );
    const vm = new PlansViewModel({ repo, services, getPick: () => ({}), saveTrace });
    const oldTrace = normalizeTrace({ ...raw, intent: 'proposal' }, repo.map);
    const newTrace = normalizeTrace({ ...raw, title: 'Replacement', intent: 'proposal' }, repo.map);
    const oldRequest = vm.open(oldTrace);
    const oldSignal = vi.mocked(services.api.stream).mock.calls[0][2];
    vm.close();
    expect(oldSignal.aborted).toBe(false);
    const newRequest = vm.open(newTrace);
    expect(oldSignal.aborted).toBe(true);
    resolveOld({ plan });
    await oldRequest;
    expect(oldTrace.plan).toBeNull();
    expect(saveTrace).not.toHaveBeenCalled();
    expect(vm.trace).toBe(newTrace);
    expect(vm.busy).toBe(true);
    expect(vm.status).toContain('Preparing implementation plan');
    resolveNew({ plan: { ...plan, summary: 'Replacement plan' }, tokens: 42 });
    await newRequest;
    expect(newTrace.plan?.summary).toBe('Replacement plan');
    expect(saveTrace).toHaveBeenCalledExactlyOnceWith(newTrace);
    expect(vm.status).toContain('42 tokens');
    expect(vm.busy).toBe(false);
    vm.dispose();
});
it('says Copied! on the Copy button for two seconds', async () => {
    vi.useFakeTimers();
    try {
        const { repo, services } = fixture();
        vi.mocked(services.api.stream).mockResolvedValue({ plan });
        const vm = new PlansViewModel({ repo, services, getPick: () => ({}), saveTrace: vi.fn(async () => {}) });
        await vm.open(normalizeTrace({ ...raw, intent: 'proposal' }, repo.map));
        await vm.copy();
        expect(services.browser.copy).toHaveBeenCalledWith(expect.stringContaining('Coupons'));
        expect(vm.copied.copied).toBe(true);
        expect(vm.status).not.toMatch(/Copied/);
        vi.advanceTimersByTime(2000);
        expect(vm.copied.copied).toBe(false);
        vm.dispose();
    } finally {
        vi.useRealTimers();
    }
});
it('ticks steps, saves them, copies them as a task list and clears them on regenerate', async () => {
    const { repo, services } = fixture();
    repo.setAiAvailable(true);
    const saveTrace = vi.fn(async () => {});
    const two = { ...plan, tasks: [...plan.tasks, { title: 'Wire', detail: 'Line one\nLine two', files: [] }], risks: ['Expiry clock'] };
    vi.mocked(services.api.stream).mockResolvedValue({ plan: two });
    const vm = new PlansViewModel({ repo, services, getPick: () => ({}), saveTrace });
    const t = observable(normalizeTrace({ ...raw, intent: 'proposal' }, repo.map));
    await vm.open(t);
    saveTrace.mockClear();
    await vm.toggleDone(0);
    expect(t.plan!.tasks[0].done).toBe(true);
    expect(saveTrace).toHaveBeenCalledExactlyOnceWith(t);
    expect(planMarkdown(t.plan!)).toBe(
        'Coupons\n\n## Steps\n\n1. [x] **Validate**\n   Check expiry\n   Files: `new: coupons.mjs`\n\n2. [ ] **Wire**\n   Line one\n   Line two\n\n## Risks\n\n- Expiry clock'
    );
    vm.toggleExpanded(0);
    expect(vm.isExpanded(0)).toBe(true);
    await vm.toggleDone(0);
    expect(t.plan!.tasks[0].done).toBeUndefined();
    expect(vm.isExpanded(0)).toBe(false);
    await vm.toggleDone(1);
    await vm.generatePlan();
    expect(t.plan!.tasks.some((task) => task.done)).toBe(false);
    vm.dispose();
});

import { expect, it, vi } from 'vitest';
import { PlansViewModel, planText } from './PlansViewModel';
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
    expect(planText(t.plan!)).toContain('new: coupons.mjs');
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
it('aborts on close, ignores late completion, and permits retry', async () => {
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
    expect(oldSignal.aborted).toBe(true);
    const newRequest = vm.open(newTrace);
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

import { expect, it, vi } from 'vitest';
import { TraceViewModel } from './TraceViewModel';
import { fixture, flow, raw } from './testFixtures';

function jobsFixture() {
    const f = fixture();
    const pending: { signal: AbortSignal; title?: (title: string) => void; resolve(value: unknown): void; reject(error: Error): void }[] = [];
    vi.mocked(f.services.api.stream).mockImplementation((_url, _body, signal, _progress, title) =>
        new Promise((resolve, reject) => pending.push({ signal, title, resolve, reject })) as never);
    vi.mocked(f.services.api.request).mockImplementation(async (_url, options) => ({
        key: 'saved-' + JSON.parse(String(options?.body || '{}')).prompt,
    }) as never);
    const vm = new TraceViewModel(f.deps);
    return { ...f, vm, pending };
}

it('keeps concurrent jobs independent and never replaces another draft on background completion', async () => {
    const { vm, pending, services } = jobsFixture();
    vm.toggleComposer();
    vm.setPrompt('First');
    vm.setOutput('flowchart', false);
    const first = vm.runTrace();
    const firstJob = vm.activeJob!;
    expect(vm.jobRows).toHaveLength(1);
    expect(firstJob.title).toBe('');
    vm.closeComposer();
    expect(pending[0].signal.aborted).toBe(false);
    vm.toggleComposer();
    expect(vm.prompt).toBe('');
    expect(vm.busy).toBe(false);
    vm.setPrompt('Second');
    vm.setOutput('architecture', false);
    vm.setOutput('flowchart', true);
    const second = vm.runTrace();
    const secondJob = vm.activeJob!;
    pending[0].title?.('First early title');
    expect(firstJob.title).toBe('First early title');
    expect(firstJob.state).toBe('running');
    expect(secondJob.title).toBe('');
    vm.closeComposer();
    vm.toggleComposer();
    vm.setPrompt('Third draft');
    pending[1].resolve({ trace: { ...raw, title: 'Second done', flow } });
    await second;
    pending[0].resolve({ trace: { ...raw, title: 'First done' } });
    await first;
    expect(services.api.request).toHaveBeenCalledTimes(2);
    expect(firstJob.result?.outputs).toEqual({ architecture: true, flowchart: false });
    expect(secondJob.result?.outputs).toEqual({ architecture: false, flowchart: true });
    expect(vm.selected).toBeNull();
    expect(vm.composerOpen).toBe(true);
    expect(vm.prompt).toBe('Third draft');
    expect(vm.jobRows).toHaveLength(2);
    vm.dispose();
});

it('reopens a running job with its original prompt and outputs without losing a new draft', async () => {
    const { vm, pending } = jobsFixture();
    vm.setPrompt('Original question');
    const run = vm.runTrace();
    const job = vm.activeJob!;
    vm.closeComposer();
    vm.toggleComposer();
    vm.setPrompt('Unrelated draft');
    vm.setOutput('flowchart', false);
    vm.closeComposer();
    vm.openJob(job);
    expect(vm.prompt).toBe('Original question');
    expect(vm.flowchart).toBe(true);
    expect(vm.busy).toBe(true);
    vm.closeComposer();
    vm.toggleComposer();
    expect(vm.prompt).toBe('Unrelated draft');
    expect(vm.flowchart).toBe(false);
    vm.closeComposer();
    vm.openJob(job);
    pending[0].resolve({ trace: { ...raw, flow } });
    await run;
    expect(vm.selected?.prompt).toBe('Original question');
    expect(vm.composerOpen).toBe(false);
    vm.dispose();
});

it('stops only the reopened job and ignores its late title and result', async () => {
    const { vm, pending, services } = jobsFixture();
    vm.setPrompt('First');
    const first = vm.runTrace();
    const firstJob = vm.activeJob!;
    vm.closeComposer();
    vm.setPrompt('Second');
    const second = vm.runTrace();
    vm.closeComposer();
    vm.openJob(firstJob);
    vm.stop();
    expect(pending[0].signal.aborted).toBe(true);
    expect(pending[1].signal.aborted).toBe(false);
    pending[0].title?.('Late title');
    pending[0].resolve({ trace: { ...raw, flow } });
    await first;
    expect(firstJob.state).toBe('stopped');
    expect(firstJob.title).toBe('Stopped trace');
    vm.closeComposer();
    pending[1].resolve({ trace: { ...raw, flow } });
    await second;
    expect(services.api.request).toHaveBeenCalledTimes(1);
    vm.dispose();
});

it('retains a failed job for retry without opening its modal or changing another draft', async () => {
    const { vm, pending } = jobsFixture();
    vm.setPrompt('First');
    const first = vm.runTrace();
    const job = vm.activeJob!;
    vm.closeComposer();
    vm.setPrompt('Other draft');
    pending[0].reject(new Error('Rate limit'));
    await first;
    expect(vm.composerOpen).toBe(false);
    expect(vm.prompt).toBe('Other draft');
    expect(job.state).toBe('failed');
    vm.openJob(job);
    expect(vm.status).toBe('Rate limit');
    expect(vm.prompt).toBe('First');
    const retry = vm.runTrace();
    expect(vm.jobRows).toHaveLength(1);
    pending[1].resolve({ trace: { ...raw, flow } });
    await retry;
    expect(vm.selected?.prompt).toBe('First');
    vm.dispose();
});

it('retains multiple failed saves and removes completed job entries when traces are deleted', async () => {
    const { vm, pending, services } = jobsFixture();
    vi.mocked(services.api.request).mockRejectedValue(new Error('Disk full'));
    vm.setPrompt('First');
    const first = vm.runTrace();
    const firstJob = vm.activeJob!;
    vm.closeComposer();
    vm.setPrompt('Second');
    const second = vm.runTrace();
    vm.closeComposer();
    pending[0].resolve({ trace: { ...raw, flow } });
    pending[1].resolve({ trace: { ...raw, flow } });
    await Promise.all([first, second]);
    expect(vm.jobRows).toHaveLength(2);
    expect(vm.jobRows.every(job => job.saveFailed)).toBe(true);
    await vm.openJob(firstJob);
    expect(vm.temp?.prompt).toBe('First');
    vi.mocked(services.api.request).mockResolvedValue({ key: 'saved-first' });
    await vm.saveExisting(vm.temp!);
    expect(firstJob.saveFailed).toBe(false);
    await vm.removeTrace(firstJob.result!);
    expect(vm.jobs).not.toContain(firstJob);
    expect(vm.jobRows).toHaveLength(1);
    vm.dispose();
});

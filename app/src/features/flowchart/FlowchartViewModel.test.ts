import { describe, it, expect, vi } from 'vitest';
import type { StreamResult } from '../../models/types';
import { autorun, runInAction } from 'mobx';
import { fixture } from './testFixture';
describe('FlowchartViewModel', () => {
    it('invalidates computed SVG after nested edits and save metadata changes', async () => {
        const { vm, trace, saveTrace } = fixture();
        vm.setTrace(trace);
        const renders: string[] = [];
        const stop = autorun(() => {
            renders.push(vm.svg);
        });
        runInAction(() => {
            vm.trace!.flow!.nodes[0].label = 'Updated decision';
        });
        expect(renders.at(-1)).toContain('Updated decision');
        expect(renders.length).toBe(2);
        saveTrace.mockImplementation(async (updated) => {
            runInAction(() => {
                updated._doc = 'saved';
            });
        });
        await vm.generate(vm.trace!);
        expect(vm.trace?._doc).toBe('saved');
        runInAction(() => {
            vm.trace!.flow!.nodes[0].label = 'Updated again';
        });
        expect(renders.at(-1)).toContain('Updated again');
        stop();
        vm.dispose();
    });
    it('fits with the opening zoom and returns step refs and docs', () => {
        const { vm, trace } = fixture();
        vm.setTrace(trace);
        vm.fit(10000, 10000, 1.2 ** 2);
        expect(vm.scale).toBeCloseTo(1.44);
        vm.select('a');
        expect(vm.references.map((ref) => ref.path)).toEqual(['main.ts', 'README.md']);
        vm.zoom(100);
        expect(vm.scale).toBe(2.5);
        vm.dispose();
    });
    it('allows integration to reselect the saved trace from onTraceUpdated', async () => {
        const { vm, trace, onTraceUpdated } = fixture();
        onTraceUpdated.mockImplementation((updated) => vm.setTrace(updated));
        await vm.generate(trace);
        expect(vm.trace?.flow).toEqual(trace.flow);
        expect(vm.busy).toBe(false);
        expect(vm.status).toBe('');
        expect(onTraceUpdated).toHaveBeenCalledOnce();
        vm.dispose();
    });
    it('generates, persists and publishes a normalized trace', async () => {
        const { vm, trace, saveTrace, onTraceUpdated } = fixture();
        await vm.generate(trace);
        expect(saveTrace).toHaveBeenCalledWith(vm.trace);
        expect(onTraceUpdated).toHaveBeenCalledWith(vm.trace);
        expect(vm.trace?.pendingFlow).toBe(false);
        expect(vm.busy).toBe(false);
        vm.dispose();
    });
    it('aborts and rejects late results when the trace changes', async () => {
        const { vm, trace, services, flow, saveTrace } = fixture();
        let resolve!: (value: StreamResult) => void;
        vi.mocked(services.api.stream).mockImplementation(
            () =>
                new Promise<never>((done) => {
                    resolve = done as unknown as (value: StreamResult) => void;
                })
        );
        const pending = vm.generate(trace);
        const signal = vi.mocked(services.api.stream).mock.calls[0][2];
        vm.setTrace(null);
        expect(signal.aborted).toBe(true);
        resolve({ flow });
        await pending;
        expect(vm.trace).toBeNull();
        expect(saveTrace).not.toHaveBeenCalled();
        vm.dispose();
    });
    it('keeps existing flow after failure and supports retry and export', async () => {
        const { vm, trace, services } = fixture();
        vi.mocked(services.api.stream).mockRejectedValueOnce(new Error('Offline'));
        await vm.generate(trace);
        expect(vm.status).toBe('Offline');
        expect(vm.trace?.flow).toEqual(trace.flow);
        await vm.generate(trace);
        expect(vm.error).toBe(false);
        await vm.copyMermaid();
        expect(services.browser.copy).toHaveBeenCalledWith(expect.stringContaining('flowchart TD'));
        vm.downloadSvg(() => '#fff');
        const [name, svg, type] = vi.mocked(services.browser.download).mock.calls[0];
        expect(name).toBe('checkout.svg');
        expect(type).toBe('image/svg+xml');
        expect(svg).toContain('<style>.fc{');
        expect(svg).toContain('.fc .change-removed>text');
        expect(svg).toContain('fill="#fff"');
        const exported = new DOMParser().parseFromString(svg, 'image/svg+xml');
        expect(exported.documentElement.getAttribute('role')).toBe('img');
        expect(exported.documentElement.getAttribute('aria-label')).toBe('Checkout');
        expect(svg).toContain('Ready?');
        expect(svg).not.toContain('var(--');
        vm.dispose();
    });
});

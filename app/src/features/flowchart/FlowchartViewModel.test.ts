import { describe, it, expect, vi } from 'vitest';
import type { StreamResult } from '../../models/types';
import { autorun, runInAction } from 'mobx';
import { fixture } from './testFixture';
import { decodeTrace, encodeTrace } from '../../models/trace';
import { FlowchartViewModel } from './FlowchartViewModel';
describe('FlowchartViewModel', () => {
    it('preserves lane metadata through sharing and remembers compact layout without changing the flow', () => {
        const { vm, trace, services } = fixture();
        trace.flow!.lanes = [{ id: 'web', label: 'Frontend' }, { id: 'api', label: 'Backend' }];
        trace.flow!.nodes[0].lane = 'web';
        trace.flow!.nodes[1].lane = 'api';
        const restored = decodeTrace(encodeTrace(trace), { nodes: [{ id: 'checkout', group: 'app', kind: 'service' }], groups: [], edges: [] });
        expect(restored.flow).toEqual(trace.flow);
        vm.setTrace(restored);
        expect(vm.hasLanes).toBe(true);
        expect(vm.layout?.lanes).toHaveLength(2);
        vm.setCompact(true);
        expect(vm.layout?.lanes).toHaveLength(0);
        expect(vm.trace?.flow?.lanes).toHaveLength(2);
        expect(services.storage.set).toHaveBeenCalledWith(vm.repo.namespace + 'flow-compact', true);
        vi.mocked(services.storage.get).mockReturnValue(true);
        const next = new FlowchartViewModel(vm.deps);
        next.setTrace(restored);
        expect(next.compact).toBe(true);
        vm.select('a');
        expect(vm.selectedLane).toBe('Frontend');
        vm.downloadSvg(() => '#fff');
        expect(vi.mocked(services.browser.download).mock.calls[0][1]).not.toContain('class="execution-lane"');
        vm.setCompact(false);
        vm.downloadSvg(() => '#fff');
        expect(vi.mocked(services.browser.download).mock.calls[1][1]).toContain('class="execution-lane"');
        vm.dispose();
        next.dispose();
    });
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
    it('lists connections by direction with layout edge indices', () => {
        const { vm, trace } = fixture();
        vm.setTrace(trace);
        expect(vm.connections).toEqual({ from: [], to: [] });
        vm.select('a');
        expect(vm.connectionTab).toBe('to');
        expect(vm.connections.to).toEqual([{ edge: expect.objectContaining({ label: 'yes' }), index: 0, other: 'b' }]);
        expect(vm.connections.from).toEqual([]);
        expect(vm.nodeLabel('b')).toBe('Done');
        vm.select('b');
        expect(vm.connections.from.map((c) => c.other)).toEqual(['a']);
        vm.hoverConnection(0, 'a');
        expect(vm.highlight).toEqual({ nodes: ['a', 'b'], edges: [0], primary: ['a'] });
        vm.setConnectionTab('from');
        expect(vm.connectionTab).toBe('from');
        vm.close();
        expect(vm.selectedId).toBeNull();
        vm.dispose();
    });
    it('shows proposal status with the linked change rationale', () => {
        const { vm, trace } = fixture();
        vm.setTrace({
            ...trace,
            intent: 'proposal',
            proposal: {
                rationale: '', assumptions: [], questions: [], edges: [],
                nodes: [{ id: 'checkout', title: 'Checkout', status: 'modified', rationale: 'Adds a retry.' } as never],
            },
        });
        vm.select('a');
        expect(vm.selectedChange).toEqual({ status: 'modified', rationale: 'Adds a retry.' });
        vm.select('b');
        expect(vm.selectedChange).toBeNull();
        vm.setTrace(trace);
        vm.select('a');
        expect(vm.selectedChange).toBeNull();
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
    it('folds a whole repo of a workspace trace into one box inside its band', () => {
        const { vm, trace } = fixture();
        trace.flow = {
            repos: [{ id: 'home', label: 'Shop' }, { id: 'api', label: 'Shop API' }],
            lanes: [{ id: 'web', label: 'Frontend', repo: 'home' }, { id: 'route', label: 'Route', repo: 'api' }, { id: 'worker', label: 'Worker', repo: 'api' }],
            nodes: [
                { id: 's', type: 'start', label: 'Open', lane: 'web' },
                { id: 'b', type: 'process', label: 'Save', lane: 'route' },
                { id: 'c', type: 'process', label: 'Queue', lane: 'worker' },
                { id: 'e', type: 'end', label: 'Done', lane: 'web' },
            ],
            edges: [{ from: 's', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'e' }],
        };
        vm.setTrace(trace);
        expect(vm.repoBands.map((b) => b.id)).toEqual(['home', 'api']);
        expect(vm.repoFoldable('api')).toBe(true);
        expect(vm.layout?.repoBands).toHaveLength(2);
        vm.toggleRepoBand('api');
        expect(vm.isRepoCollapsed('api')).toBe(true);
        const box = vm.displayFlow?.nodes.find((n) => n.id === 'c:repo:api');
        expect(box?.members).toEqual(['b', 'c']);
        expect(box?.lane).toBe('route');
        // the lane it is drawn in stands for both of the repo's lanes
        expect(vm.displayFlow?.lanes?.map((l) => l.label)).toEqual(['Frontend', '2 lanes', 'Worker']);
        expect(vm.layout?.lanes.map((l: { label: string }) => l.label)).toEqual(['Frontend', '2 lanes']);
        expect(vm.canRename('c:repo:api')).toBe(false);
        expect(vm.layout?.repoBands.map((b: { id: string }) => b.id)).toEqual(['home', 'api']);
        expect(vm.expand('c:repo:api')).toBeNull();
        expect(vm.isRepoCollapsed('api')).toBe(false);
        // expanding the open box selects its first step
        vm.toggleRepoBand('api');
        vm.select('c:repo:api');
        expect(vm.expand('c:repo:api')).toBe('b');
        expect(vm.selectedId).toBe('b');
        expect(vm.collapsedCount).toBe(0);
        vm.toggleRepoBand('api');
        vm.expandAll();
        expect(vm.collapsedCount).toBe(0);
        vm.dispose();
    });
    it('collapses lanes and shift-selected steps, and remembers them per trace', () => {
        const { vm, trace, services } = fixture();
        trace.flow = {
            lanes: [{ id: 'web', label: 'Frontend' }, { id: 'api', label: 'Backend' }],
            nodes: [
                { id: 's', type: 'start', label: 'Open', lane: 'web' },
                { id: 'a', type: 'process', label: 'Send', lane: 'web' },
                { id: 'b', type: 'process', label: 'Save', lane: 'api' },
                { id: 'c', type: 'process', label: 'Reply', lane: 'api' },
                { id: 'e', type: 'end', label: 'Done', lane: 'web' },
            ],
            edges: [{ from: 's', to: 'a' }, { from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'e' }],
        };
        trace._doc = 'checkout.json';
        vm.setTrace(trace);
        expect(vm.laneFoldable('api')).toBe(true);
        vm.select('b');
        vm.toggleLane('api');
        expect(vm.displayFlow?.nodes.map((n) => n.id)).toEqual(['s', 'a', 'c:lane:api', 'e']);
        expect(vm.selectedId).toBe('c:lane:api');
        expect(vm.selected?.collapsed).toBe(true);
        expect(vm.canRename('c:lane:api')).toBe(false);
        expect(vm.members('c:lane:api').map((m) => m.label)).toEqual(['Save', 'Reply']);
        expect(vm.collapsedCount).toBe(1);
        const key = vm.repo.namespace + 'flow-collapse:checkout.json';
        expect(services.storage.set).toHaveBeenLastCalledWith(key, { repos: [], lanes: ['api'], groups: [] });
        vm.expand('c:lane:api', 'c');
        expect(vm.selectedId).toBe('c');
        vm.expandAll();
        vm.close();
        vm.mark('s');
        vm.mark('a');
        vm.collapseMarked('Kick off');
        vm.close();
        vm.mark('b');
        vm.mark('zz');
        vm.mark('c:s1');
        vm.mark('e');
        expect(vm.marked).toEqual(['b', 'e']);
        vm.collapseMarked();
        expect(vm.selectedId).toBe('c:s2');
        expect(vm.selected?.label).toBe('Save (+1 more)');
        vm.renameGroup('c:s2', 'Wrap up');
        expect(vm.selected?.label).toBe('Wrap up');
        vi.mocked(services.storage.get).mockImplementation((k: string, fallback: unknown) =>
            k === key ? { lanes: ['web'], groups: [] } : fallback);
        const next = new FlowchartViewModel(vm.deps);
        next.setTrace(trace);
        expect(next.collapsedCount).toBe(1);
        expect(next.displayFlow?.nodes.find((n) => n.collapsed)?.members).toEqual(['s', 'a', 'e']);
        vm.dispose();
        next.dispose();
    });
    it('starts a selection from the open step, shows it in the panel, and renames groups live', () => {
        const { vm, trace } = fixture();
        trace.flow = {
            nodes: [
                { id: 'b', type: 'process', label: 'Save' },
                { id: 'c', type: 'process', label: 'Reply' },
                { id: 'e', type: 'end', label: 'Done' },
            ],
            edges: [{ from: 'b', to: 'c' }, { from: 'c', to: 'e' }],
        };
        vm.setTrace(trace);
        expect(vm.panelOpen).toBe(false);
        vm.select('b');
        vm.mark('e');
        expect(vm.marked).toEqual(['b', 'e']);
        expect(vm.selectedId).toBe(null);
        expect(vm.panelOpen).toBe(true);
        expect(vm.markedNodes.map((n) => n.id)).toEqual(['b', 'e']);
        vm.mark('b');
        vm.mark('e');
        expect(vm.panelOpen).toBe(false);
        expect(vm.markMode).toBe(false);
        vm.toggleSelecting();
        expect(vm.markMode).toBe(true);
        vm.mark('b');
        vm.mark('c');
        vm.collapseMarked();
        expect(vm.groupLabel('c:s1')).toBe('');
        vm.renameGroup('c:s1', 'Wr');
        expect(vm.groupLabel('c:s1')).toBe('Wr');
        expect(vm.selected?.label).toBe('Wr');
        vm.setTrace(trace);
        expect(vm.markMode).toBe(false);
        vm.dispose();
    });
});

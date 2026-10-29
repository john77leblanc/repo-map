import { describe, it, expect, vi } from 'vitest';
import { fixture } from './testFixture';
import { decodeTrace, encodeTrace } from '../../models/trace';

/** A closer look at "Ready?" (a decision with one arrow out, "yes" to Done). */
const expansion = {
    summary: 'Checks the cart and the session.',
    gaps: '',
    nodes: [
        { id: 'x1', type: 'process', label: 'Load the cart', refs: [{ path: 'cart.ts', start: 4, end: 9 }] },
        { id: 'x2', type: 'decision', label: 'Signed in?' },
        { id: 'x3', type: 'error', label: 'Ask to sign in' },
    ],
    edges: [{ from: 'x1', to: 'x2' }, { from: 'x2', to: 'x3', label: 'no' }],
    entry: 'x1',
    exits: [{ arrow: 1, from: 'x2' }],
};

describe('FlowchartViewModel closer looks', () => {
    it('asks for a closer look, saves it on the trace and draws it in place', async () => {
        const { vm, trace, services, saveTrace } = fixture();
        vi.mocked(services.api.stream).mockResolvedValueOnce({ expansion, used: { agent: 'codex', model: 'm', effort: '', label: 'Codex' } });
        vm.setTrace(trace);
        vm.select('a');
        expect(vm.canExpand('a')).toBe(true);
        await vm.lookCloser('a');
        const [path, body] = vi.mocked(services.api.stream).mock.calls[0];
        expect(path).toBe('/api/flow/expand');
        expect(body).toMatchObject({ node: 'a', agent: 'codex' });
        const saved = vi.mocked(saveTrace).mock.calls[0][0];
        expect(saved.expansions?.a.nodes.map((n: { id: string }) => n.id)).toEqual(['a.1', 'a.2', 'a.3']);
        expect(saved.expansions?.a.used?.label).toBe('Codex');
        // drawn in the chart, with arrows rewired and a frame
        expect(vm.isShown('a')).toBe(true);
        expect(vm.displayFlow?.nodes.map((n) => n.id)).toEqual(['a.1', 'a.2', 'a.3', 'b']);
        expect(vm.displayFlow?.edges).toContainEqual({ from: 'a.2', to: 'b', label: 'yes' });
        expect(vm.layout?.frames).toHaveLength(1);
        expect(vm.svg).toContain('Expanded: Ready?');
        // a sub-box shows its own code, and can't be expanded again
        vm.select('a.1');
        expect(vm.references).toEqual([{ path: 'cart.ts', start: 4, end: 9 }]);
        expect(vm.canExpand('a.1')).toBe(false);
        expect(vm.expansionFor('a.1')?.id).toBe('a');
        // folding back selects the box again
        vm.setShown('a', false);
        expect(vm.selectedId).toBe('a');
        expect(vm.displayFlow?.nodes.find((n) => n.id === 'a')?.expandable).toBe(true);
        expect(vm.miniSvg('a')).toContain('Load the cart');
        expect(vm.miniSvg('a')).toContain('role="group"');
        expect(vm.miniSvg('a', 'a.2')).toMatch(/class="fn [^"]* sel" data-id="a.2"/);
        expect(vm.miniSvg('a', 'b')).not.toContain(' sel"');
        expect(vm.miniSvg('a', 'a.2').match(/ sel"/g)).toHaveLength(1);
        // a step picked in the mini drawing draws the closer look again
        vm.openCloserStep('a', 'a.3');
        expect(vm.isShown('a')).toBe(true);
        expect(vm.selectedId).toBe('a.3');
        vm.setShown('a', false);
        expect(services.storage.set).toHaveBeenCalledWith(vm.repo.namespace + 'flow-shown:Checkout', []);
    });

    it('keeps closer looks through sharing, drops them on redraw, and deletes them', async () => {
        const { vm, trace, services, saveTrace, flow } = fixture();
        vi.mocked(services.api.stream).mockResolvedValueOnce({ expansion });
        vm.setTrace(trace);
        await vm.lookCloser('a');
        const withLook = vm.trace!;
        const restored = decodeTrace(encodeTrace(withLook), { nodes: [{ id: 'checkout', group: 'app', kind: 'service' }], groups: [], edges: [] });
        expect(restored.expansions?.a.exits).toEqual([{ to: 'b', from: 'a.2' }]);

        await vm.removeExpansion('a');
        expect(vm.trace?.expansions).toBeUndefined();
        expect(vm.isShown('a')).toBe(false);
        expect(vi.mocked(saveTrace).mock.calls.at(-1)?.[0].expansions).toBeUndefined();

        vm.setTrace(restored);
        vi.mocked(services.api.stream).mockResolvedValueOnce({ flow });
        await vm.generate(vm.trace!);
        expect(vm.trace?.expansions).toBeUndefined();
    });

    it('reports an unusable answer without changing the trace', async () => {
        const { vm, trace, services, saveTrace } = fixture();
        vi.mocked(services.api.stream).mockResolvedValueOnce({ expansion: { nodes: [] } });
        vm.setTrace(trace);
        await vm.lookCloser('a');
        expect(vm.error).toBe(true);
        expect(vm.status).toMatch(/usable steps/);
        expect(vm.trace?.expansions).toBeUndefined();
        expect(saveTrace).not.toHaveBeenCalled();
        expect(vm.expandingId).toBeNull();
    });
});

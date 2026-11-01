import { afterEach, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { fixture, raw } from '../traces/testFixtures';
import { TraceViewModel } from '../traces/TraceViewModel';
import { decodeTrace, encodeTrace, normalizeTrace } from '../../models/trace';
import { ComponentsViewModel } from './ComponentsViewModel';
import type { ComponentMap, ComponentsTrace } from '../../models/types';

const base: ComponentMap = { version: 1, applicability: 'applicable', summary: 'Pages.', gaps: [],
    components: [{ id: 'cart-page', label: 'CartPage', detail: '', tags: [], refs: [] },
        { id: 'price', label: 'PriceLine', detail: '', tags: [], refs: [] }],
    uses: [{ from: 'cart-page', to: 'price' }], screens: [{ screen: 'cart', root: 'cart-page' }] };
const output: ComponentsTrace = { version: 1, base, applicability: 'relevant', summary: 'A coupon field.', gaps: [],
    involved: [{ id: 'cart-page', note: 'Shows the cart.', refs: [] }],
    changes: { components: [{ id: 'proposal-coupon', label: 'CouponField', detail: '', tags: ['form'], refs: [], status: 'new', rationale: 'Enter a code.' }],
        uses: [{ from: 'cart-page', to: 'proposal-coupon', status: 'new', rationale: '' }] } };
afterEach(cleanup);

function setup() {
    const f = fixture();
    const components = new ComponentsViewModel({ repo: f.repo, services: f.services, sitemap: () => null });
    const vm = new TraceViewModel({ ...f.deps, components });
    return { ...f, components, vm };
}

it('round trips a components-only proposal trace', () => {
    const { repo } = fixture();
    const trace = normalizeTrace({ ...raw, steps: [], intent: 'proposal', components: output,
        outputs: { architecture: false, flowchart: false, components: true } }, repo.map);
    const restored = decodeTrace(encodeTrace(trace), { nodes: [], edges: [], groups: [] });
    expect(restored.components).toEqual(trace.components);
    expect(restored.outputs).toEqual({ architecture: false, flowchart: false, components: true });
});

it('needs the component map, then asks for Components, opens on it, and remembers the choice', async () => {
    const { vm, components, services, deps, storage, repo } = setup();
    vm.architecture = false;
    vm.flowchart = false;
    vm.setOutput('components', true);
    expect(storage.get(repo.namespace + 'withcomponents')).toBe('1');
    vm.setPrompt('Add a coupon field');
    vi.mocked(services.api.get).mockResolvedValue({ components: null, status: { state: 'missing' } });
    await vm.runTrace();
    await vi.waitFor(() => expect(vm.activeJob?.busy).toBe(false));
    expect(services.api.stream).not.toHaveBeenCalled();
    expect(vm.status).toContain('Generate the component map');
    components.components = base;
    vi.mocked(services.api.stream).mockResolvedValue({ trace: { ...raw, steps: [], intent: 'proposal', components: output } });
    await vm.runTrace();
    await vi.waitFor(() => expect(vm.selected?.outputs.components).toBe(true));
    expect(services.api.stream).toHaveBeenLastCalledWith('/api/trace', expect.objectContaining({ components: true, architecture: false, flow: false }),
        expect.any(AbortSignal), expect.any(Function), expect.any(Function));
    expect(deps.onSelect).toHaveBeenLastCalledWith(vm.selected, 'components');
    vm.dispose();
    components.dispose();
});

it('keeps the other outputs when Components comes back missing', async () => {
    const { vm, components, services } = setup();
    components.components = base;
    vm.architecture = true;
    vm.flowchart = false;
    vm.components = true;
    vm.prompt = 'Checkout';
    vi.mocked(services.api.stream).mockResolvedValue({ trace: { ...raw } });
    await vm.runTrace();
    await vi.waitFor(() => expect(vm.selected?.pendingComponents).toBe(true));
    expect(vm.selected?.outputs.architecture).toBe(true);
    expect(vm.status).toBe('Other outputs were kept, but Components was missing. Use Views to draw it again.');
    vm.dispose();
    components.dispose();
});

it('asks a review for Components and re-runs it with them', () => {
    const { vm, components, services } = setup();
    components.components = base;
    vi.mocked(services.api.stream).mockReturnValue(new Promise(() => {}) as never);
    vm.components = true;
    vm.flowchart = false;
    vm.startReview({ local: true, base: 'main' });
    expect(services.api.stream).toHaveBeenLastCalledWith('/api/review', expect.objectContaining({ components: true, local: true }),
        expect.any(AbortSignal), expect.any(Function), expect.any(Function));
    vm.dispose();
    components.dispose();
});

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { observable } from 'mobx';
import { fixture, raw, flow } from '../traces/testFixtures';
import { TraceViewModel } from '../traces/TraceViewModel';
import { normalizeTrace, encodeTrace, decodeTrace } from '../../models/trace';
import { SitemapViewModel } from './SitemapViewModel';
import { SitemapWorkspace } from './SitemapWorkspace';
import type { Sitemap, SitemapTrace, StreamResult } from '../../models/types';

const base: Sitemap = { version: 1, applicability: 'incomplete', summary: 'Shop screens', gaps: ['Some routes unavailable'],
    generatedAt: '2026-10-23T10:00:00Z', applications: [{ id: 'shop', label: 'Shop' }, { id: 'admin', label: 'Admin' }],
    screens: ['cart', 'checkout', 'receipt', 'isolated', 'admin'].map((id) => ({ id, app: id === 'admin' ? 'admin' : 'shop', label: id, route: '/' + id, detail: id, refs: [] })),
    navigation: [{ from: 'cart', to: 'checkout', label: 'Continue', condition: 'Signed in', refs: [] },
        { from: 'checkout', to: 'receipt', label: 'Pay', condition: '', refs: [] },
        { from: 'cart', to: 'admin', label: 'Manage', condition: 'Administrator', refs: [] }] };
const output: SitemapTrace = { version: 1, base, applicability: 'relevant', summary: 'Guest checkout', gaps: [],
    steps: [{ screen: 'cart', note: 'Review cart', refs: [] }, { screen: 'cart', note: 'Edit cart', refs: [] }], navigation: [0],
    changes: { screens: [{ ...base.screens[1], route: '/guest', status: 'modified', rationale: 'Accept guests' }], navigation: [] } };
afterEach(cleanup);

it('round trips screen-only proposal traces without depending on architecture or the latest sitemap', () => {
    const { repo } = fixture();
    const trace = normalizeTrace({ ...raw, steps: [], intent: 'proposal', sitemap: output, outputs: { architecture: false, flowchart: false, sitemap: true } }, repo.map);
    const restored = decodeTrace(encodeTrace(trace), { nodes: [], edges: [], groups: [] });
    expect(restored.sitemap).toEqual(trace.sitemap);
    expect(restored.steps).toEqual([]);
    expect(restored.outputs).toEqual({ architecture: false, flowchart: false, sitemap: true });
});

it('exports the visible journey and proposals with standalone context styling', async () => {
    const { repo, services } = fixture();
    const vm = new SitemapViewModel({ repo, services });
    vm.setTrace(observable(normalizeTrace({ ...raw, title: 'Guest / Checkout!', intent: 'proposal', sitemap: output }, repo.map)));
    await vm.copyMermaid();
    const source = vi.mocked(services.browser.copy).mock.calls[0][0];
    expect(source).toContain('1, 2. cart');
    expect(source).toContain('[Modified] checkout');
    expect(source).not.toContain('isolated');
    vm.select('checkout');
    await vm.exportAs('svg', () => '#123456');
    const [name, svg, type] = vi.mocked(services.browser.download).mock.calls[0] as [string, string, string];
    expect(name).toBe('guest-checkout-sitemap.svg');
    expect(type).toBe('image/svg+xml');
    expect(svg).toContain('.fc .context{opacity:.35}');
    expect(svg).toContain('change-modified');
    expect(svg).not.toContain('class="fn t-process sel');
    expect(svg).not.toContain('isolated');
    vm.setScope('app');
    await vm.exportAs('svg', () => '#fff');
    expect(vi.mocked(services.browser.download).mock.calls[1][1]).toContain('isolated');
    const { container } = render(<SitemapWorkspace vm={vm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Diagram key' }));
    expect(container.querySelector('#sitemap-key [data-proposal-key]')?.hasAttribute('hidden')).toBe(false);
    expect(container.querySelector('#sitemap-info')?.hasAttribute('hidden')).toBe(true);
    expect(screen.getByText('dimmed: surrounding context')).toBeTruthy();
    vm.dispose();
});

it.each([false, true])('ignores stale clipboard completion or failure after switching traces (failure=%s)', async failure => {
    const { repo, services } = fixture();
    const vm = new SitemapViewModel({ repo, services });
    vm.setTrace(observable(normalizeTrace({ ...raw, sitemap: output }, repo.map)));
    let finish!: () => void;
    vi.mocked(services.browser.copy).mockImplementationOnce(() => new Promise<void>((resolve, reject) => {
        finish = () => failure ? reject(new Error('Denied')) : resolve();
    }));
    const pending = vm.copyMermaid();
    vm.setTrace(null);
    finish();
    await pending;
    expect(vm.copied).toBe(false);
    expect(vm.error).toBe(false);
    expect(vm.message).toBe('');
    vm.dispose();
});

it('shows repeated journey steps, nearby context, cross-application navigation, and original proposal values', async () => {
    const { repo, services } = fixture();
    const vm = new SitemapViewModel({ repo, services });
    vm.setTrace(observable(normalizeTrace({ ...raw, intent: 'proposal', sitemap: output }, repo.map)));
    const before = JSON.stringify(output.base);
    const { container } = render(<SitemapWorkspace vm={vm} />);
    // Show starts on the trace's own screens
    expect(vm.scope).toBe('trace');
    expect(container.querySelector('[data-id="admin"]')).toBeNull();
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'nearby' } });
    expect(container.querySelector('[data-id="isolated"]')).toBeNull();
    expect(container.querySelector('[data-id="admin"]')?.classList.contains('context')).toBe(true);
    expect(container.querySelector('[data-id="cart"]')?.textContent).toContain('1, 2. cart');
    expect(screen.queryByText('Review cart')).toBeNull();
    expect(screen.queryByText('Edit cart')).toBeNull();
    // the panel stays closed until a screen is picked; a journey screen opens its trace step
    expect(container.querySelector('#sitemap-details')).toBeNull();
    fireEvent.click(container.querySelector('[data-id="cart"]')!);
    const card = () => container.querySelector('#sitemap-details .trace-step')!;
    expect(card().textContent).toContain('1 of 2');
    expect(card().textContent).toContain('Review cart');
    fireEvent.click(container.querySelector('#sitemap-step-next')!);
    expect(card().textContent).toContain('2 of 2');
    expect(card().textContent).toContain('Edit cart');
    expect(container.querySelector<HTMLButtonElement>('#sitemap-step-next')!.disabled).toBe(true);
    fireEvent.click(container.querySelector('#sitemap-step-prev')!);
    expect(vm.stepIndex).toBe(0);
    expect(vm.selectedId).toBe('cart');
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'trace' } });
    expect(container.querySelector('[data-id="admin"]')).toBeNull();
    expect(container.querySelector('[data-id="cart"]')).not.toBeNull();
    expect(container.querySelector('[data-id="checkout"]')).not.toBeNull();
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'nearby' } });
    fireEvent.keyDown(container.querySelector('[data-id="checkout"]')!, { key: 'Enter' });
    // off the journey: no trace step; the change chip under the title and a Modified sub-heading in About
    expect(container.querySelector('#sitemap-details .trace-step')).toBeNull();
    expect(container.querySelector('#sitemap-details .fside-kind .proposal-badge.modified')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'About' }));
    const change = container.querySelector('#sitemap-details .flow-change')!;
    expect(change.querySelector('h4.modified')?.textContent).toBe('Modified');
    expect(change.textContent).toContain('Accept guests');
    expect(change.textContent).toContain('Was: checkout — /checkout');
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'app' } });
    expect(container.querySelector('[data-id="isolated"]')).not.toBeNull();
    expect(screen.getByLabelText('Application')).toBeTruthy();
    vi.mocked(services.api.get).mockResolvedValue({ sitemap: { ...base, screens: [] }, status: { state: 'stale' } });
    await act(() => vm.load());
    expect(vm.output?.base.screens.length).toBe(5);
    expect(JSON.stringify(output.base)).toBe(before);
    vm.dispose();
});

it('lists navigation as connection rows in the screen panel, with hover highlighting', () => {
    const { repo, services } = fixture();
    const vm = new SitemapViewModel({ repo, services });
    vm.setTrace(observable(normalizeTrace({ ...raw, intent: 'proposal', sitemap: output }, repo.map)));
    const { container } = render(<SitemapWorkspace vm={vm} />);
    fireEvent.click(container.querySelector('[data-id="cart"]')!);
    expect(vm.stepIndex).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: /^Navigation/ }));
    const panel = container.querySelector<HTMLElement>('#sitemap-details')!;
    expect(within(panel).getByRole('tab', { name: 'From (0)' }).hasAttribute('disabled')).toBe(true);
    expect(within(panel).getByRole('tab', { name: 'To (2)' }).getAttribute('aria-selected')).toBe('true');
    const rows = [...panel.querySelectorAll('.flow-conn button.cl')];
    expect(rows.map((row) => row.querySelector('b')?.textContent)).toEqual(['checkout', 'Admin: admin']);
    // the journey link first; a nearby one is muted and tagged
    expect(rows[1].classList.contains('context')).toBe(true);
    expect(rows[1].querySelector('em')?.textContent).toBe('nearby');
    // the connected screen's change chip, the link as an arrow, its condition below
    expect(rows[0].querySelector('.cl-title .proposal-badge.modified')).toBeTruthy();
    expect(rows[0].querySelector('.fl-arrow')?.textContent).toBe('Continue');
    expect(rows[0].querySelector('.cl-note')?.textContent).toBe('When: Signed in');
    const checkout = rows[0] as HTMLElement;
    fireEvent.mouseEnter(checkout);
    expect(container.querySelector('#sitemap-svgbox svg')?.classList.contains('hovering')).toBe(true);
    expect(container.querySelector('[data-id="checkout"]')?.classList.contains('hl')).toBe(true);
    expect(container.querySelectorAll('.fe.hl')).toHaveLength(1);
    // Only the screen the row names is the main highlight; the selected end stays a neighbour.
    expect([...container.querySelectorAll('.fn.hl-main')].map((n) => (n as SVGElement).dataset.id)).toEqual(['checkout']);
    fireEvent.mouseLeave(checkout);
    // Leaving falls back to the pinned (selected) screen and its neighbours.
    expect(vm.highlight?.nodes[0]).toBe('cart');
    expect(container.querySelector('[data-id="cart"]')?.classList.contains('hl')).toBe(true);
    expect(container.querySelectorAll('.fe.hl')).toHaveLength(vm.highlight!.edges.length);
    // A non-journey screen has no trace step; its rows lead back to the journey.
    fireEvent.click(checkout);
    expect(vm.stepIndex).toBeNull();
    expect(panel.querySelector('.trace-step')).toBeNull();
    expect(within(panel).getByRole('tab', { name: 'From (1)' })).toBeTruthy();
    expect(within(panel).getByRole('tab', { name: 'To (1)' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(within(panel).getByRole('tab', { name: 'From (1)' }));
    fireEvent.click(panel.querySelector('button.cl[data-go="cart"]')!);
    expect(vm.stepIndex).toBe(0);
    // Diagram clicks step through repeat visits, then clear.
    fireEvent.click(container.querySelector('[data-id="cart"]')!);
    expect(vm.stepIndex).toBe(1);
    fireEvent.click(container.querySelector('[data-id="cart"]')!);
    expect(vm.selectedId).toBeNull();
    expect(container.querySelector('#sitemap-details')).toBeNull();
    // Selecting a hidden screen widens the Show scope.
    act(() => {
        vm.setScope('trace');
        vm.select('receipt');
    });
    expect(vm.scope).toBe('nearby');
    expect(container.querySelector('[data-id="receipt"]')).not.toBeNull();
    vm.dispose();
});
it('keeps results after cancelled or failed redraws and saves a successful retry', async () => {
    const { repo, services } = fixture();
    const saveTrace = vi.fn();
    const vm = new SitemapViewModel({ repo, services, saveTrace, getPick: () => ({ agent: 'api' }) });
    const trace = observable(normalizeTrace({ ...raw, intent: 'proposal', sitemap: output }, repo.map));
    vm.setTrace(trace);
    let resolve!: (result: StreamResult) => void;
    vi.mocked(services.api.stream).mockImplementationOnce(() => new Promise<never>((done) => { resolve = done as unknown as typeof resolve; }));
    const original = trace.sitemap;
    const pending = vm.generateTrace();
    vm.stop();
    resolve({ sitemap: { ...output, summary: 'Late response' } });
    await pending;
    expect(trace.sitemap).toBe(original);
    expect(saveTrace).not.toHaveBeenCalled();
    vi.mocked(services.api.stream).mockRejectedValueOnce(new Error('Provider failed'));
    await vm.generateTrace();
    expect(trace.sitemap).toBe(original);
    expect(vm.message).toBe('Provider failed');
    vi.mocked(services.api.stream).mockResolvedValueOnce({ sitemap: { ...output, applicability: 'none', summary: 'No screens apply.' } });
    await vm.generateTrace();
    expect(trace.sitemap?.applicability).toBe('none');
    expect(trace.outputs.sitemap).toBe(true);
    expect(vm.layout).toBeNull();
    expect(saveTrace).toHaveBeenCalledWith(trace);
    vm.dispose();
});

it('requires a base sitemap, preserves the question, and supports Sitemap-only creation and remembered choices', async () => {
    const { repo, services, deps, storage } = fixture();
    const sitemap = new SitemapViewModel({ repo, services });
    const vm = new TraceViewModel({ ...deps, sitemap });
    vm.architecture = false;
    vm.flowchart = false;
    vm.sitemap = true;
    vm.setPrompt('Add guest checkout');
    vi.mocked(services.api.get).mockResolvedValue({ sitemap: null, status: { state: 'missing' } });
    await vm.runTrace();
    expect(services.api.stream).not.toHaveBeenCalled();
    expect(vm.prompt).toBe('Add guest checkout');
    sitemap.sitemap = base;
    vi.mocked(services.api.stream).mockResolvedValue({ trace: { ...raw, steps: [], intent: 'proposal', sitemap: output } });
    await vm.runTrace();
    expect(vm.selected?.outputs.sitemap).toBe(true);
    expect(deps.onSelect).toHaveBeenLastCalledWith(vm.selected, 'sitemap');
    expect(services.api.stream).toHaveBeenCalledWith('/api/trace', expect.objectContaining({ sitemap: true, architecture: false, flow: false }), expect.any(AbortSignal), expect.any(Function), expect.any(Function));
    vm.setOutput('sitemap', true);
    expect(storage.get(repo.namespace + 'withsitemap')).toBe('1');
    vm.dispose();
    sitemap.dispose();
});

it.each([[true, false], [false, true], [true, true]])('keeps successful outputs when Sitemap is missing (architecture=%s flowchart=%s)', async (architecture, flowchart) => {
    const { repo, services, deps } = fixture();
    const sitemap = new SitemapViewModel({ repo, services });
    sitemap.sitemap = base;
    const vm = new TraceViewModel({ ...deps, sitemap });
    vm.architecture = architecture;
    vm.flowchart = flowchart;
    vm.sitemap = true;
    vm.prompt = 'Checkout';
    vi.mocked(services.api.stream).mockResolvedValue({ trace: { ...raw, flow: flowchart ? flow : undefined } });
    await vm.runTrace();
    expect(vm.selected?.pendingSitemap).toBe(true);
    expect(vm.selected?.outputs.architecture).toBe(architecture);
    expect(vm.selected?.outputs.flowchart).toBe(flowchart);
    expect(vm.status).toContain('Sitemap was missing');
    vm.dispose();
    sitemap.dispose();
});

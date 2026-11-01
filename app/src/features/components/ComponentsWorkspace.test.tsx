import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { RepositoryModel } from '../../models/RepositoryModel';
import type { ComponentsResult, Sitemap, Trace } from '../../models/types';
import type { Services } from '../../shared/services/contracts';
import { ComponentsViewModel } from './ComponentsViewModel';
import { ComponentsWorkspace } from './ComponentsWorkspace';
import { ROOTS, TRACE } from './ComponentGraphViewModel';

const sitemap: Sitemap = {
    version: 1, applicability: 'applicable', summary: 'Two screens.', gaps: [],
    applications: [{ id: 'shop', label: 'Storefront' }],
    screens: [
        { id: 'home', app: 'shop', label: 'Dashboard', route: '/', detail: '', refs: [] },
        { id: 'shop', app: 'shop', label: 'Shop', route: '/products/:id', detail: '', refs: [] },
    ],
    navigation: [],
};
const ref = { path: 'src/Home.tsx', start: 1, end: 9 };
const result: ComponentsResult = { status: { state: 'current' }, components: {
    version: 1, applicability: 'applicable', summary: 'Pages and parts.', gaps: ['No router file.'],
    components: [
        { id: 'price', label: 'PriceLine', detail: '', tags: [], refs: [ref] },
        { id: 'home-page', label: 'HomePage', detail: 'The dashboard.', tags: ['state'], refs: [ref] },
        { id: 'shop-page', label: 'ShopPage', detail: '', tags: [], refs: [ref] },
        { id: 'chart', label: 'Chart', detail: '', tags: [], refs: [ref] },
        { id: 'orphan', label: 'Orphan', detail: '', tags: [], refs: [ref] },
    ],
    uses: [{ from: 'home-page', to: 'price' }, { from: 'shop-page', to: 'price' }, { from: 'home-page', to: 'chart' }],
    screens: [{ screen: 'home', root: 'home-page' }, { screen: 'shop', root: 'shop-page' }],
} };
function fixture({ map = sitemap as Sitemap | null } = {}) {
    const services: Services = {
        api: { get: vi.fn().mockResolvedValue(result), request: vi.fn(), stream: vi.fn().mockResolvedValue(result) },
        storage: { get: vi.fn(), set: vi.fn(), getRaw: vi.fn(), setRaw: vi.fn() },
        browser: { copy: vi.fn(), download: vi.fn(), reload: vi.fn() },
    };
    const repo = new RepositoryModel(services);
    const openScreen = vi.fn();
    const vm = new ComponentsViewModel({ repo, services, sitemap: () => map, openScreen });
    return { vm, services, openScreen };
}
afterEach(cleanup);

describe('Components', () => {
    it('shows every component with the roots on top, no screen boxes, and narrows to a screen', async () => {
        const { vm } = fixture();
        await vm.load();
        const { container } = render(<ComponentsWorkspace vm={vm} />);
        const graph = vm.graph;
        expect(graph.scope).toBe(ROOTS);
        expect(graph.roots).toEqual(['home-page', 'shop-page', 'orphan']);
        // roots first (map order), then the rest; no screen nodes
        expect(graph.graph.nodes.map((n) => n.id)).toEqual(['home-page', 'shop-page', 'orphan', 'price', 'chart']);
        expect(graph.graph.nodes.some((n) => n.id.startsWith('screen:'))).toBe(false);
        expect(container.querySelector('#components-canvas')).toBeTruthy();
        const show = screen.getByLabelText('Show');
        expect([...(show as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['All roots', 'Dashboard', 'Shop']);
        fireEvent.change(show, { target: { value: 'home' } });
        expect(graph.graph.nodes.map((n) => n.id)).toEqual(['home-page', 'price', 'chart']);
        expect(graph.graph.edges).toEqual([{ from: 'home-page', to: 'price' }, { from: 'home-page', to: 'chart' }]);
    });
    it('opens a panel with Used in, Connections and References; Used in goes to the screen', async () => {
        const { vm, openScreen } = fixture();
        await vm.load();
        render(<ComponentsWorkspace vm={vm} />);
        act(() => vm.graph.pick('price'));
        const panel = screen.getByRole('complementary', { name: 'Component details' });
        expect(panel.textContent).toContain('PriceLine');
        expect(screen.getByRole('tab', { name: 'Rendered by (2)' }).getAttribute('aria-selected')).toBe('true');
        fireEvent.click(within(panel).getByRole('button', { name: /^Used in/ }));
        const used = within(panel).getByRole('region', { name: 'Screens using this component' });
        expect(used.textContent).toContain('/products/:id');
        fireEvent.click(within(used).getByRole('button', { name: /^Shop/ }));
        expect(openScreen).toHaveBeenCalledWith('shop');
        // an orphan is on no screen (Used in stays open between components)
        act(() => vm.graph.pick('orphan'));
        expect(screen.getByText('Not on any screen.')).toBeTruthy();
    });
    it('shows a screen with a component open, widening when the screen does not show it', async () => {
        const { vm } = fixture();
        await vm.load();
        act(() => vm.graph.show('shop', 'shop-page'));
        expect(vm.graph.scope).toBe('shop');
        expect(vm.graph.selectedId).toBe('shop-page');
        act(() => vm.graph.show('shop'));
        expect(vm.graph.selectedId).toBeNull();
        act(() => vm.graph.select('chart'));
        expect(vm.graph.scope).toBe(ROOTS);
    });
    it('generates components, keeps the old map on failure, and needs a sitemap', async () => {
        const { vm, services } = fixture();
        render(<ComponentsWorkspace vm={vm} />);
        // generating lives in Settings → Map → Views now, not the toolbar
        expect(screen.queryByRole('button', { name: /Generate components|Regenerate/ })).toBeNull();
        await act(() => vm.generate());
        await waitFor(() => expect(vm.components).toBeTruthy());
        expect(services.api.stream).toHaveBeenLastCalledWith('/api/components/generate', {}, expect.anything(), expect.any(Function));
        expect(vm.message).toBe('Component map saved.');
        vi.mocked(services.api.stream).mockRejectedValueOnce(new Error('AI failed.'));
        await vm.generate();
        expect(vm.error).toBe(true);
        expect(vm.components).toEqual(result.components);
        cleanup();
        const empty = fixture({ map: null });
        render(<ComponentsWorkspace vm={empty.vm} />);
        expect(empty.vm.canGenerate).toBe(false);
        expect(screen.getByText('Generate the sitemap first: components are mapped from its screens.')).toBeTruthy();
        await empty.vm.generate();
        expect(empty.services.api.stream).not.toHaveBeenCalled();
    });
    it('shows a trace’s output: its components first, changes marked, steps and changes in the panel', async () => {
        const { vm } = fixture();
        await vm.load();
        const base = result.components!;
        const trace = { intent: 'proposal', title: 'Add a chart', prompt: 'p', summary: '', gaps: '', steps: [], edges: [], refs: [],
            outputs: { architecture: false, flowchart: false, components: true }, pendingFlow: false,
            components: { version: 1, base, applicability: 'relevant', summary: 'Home page gains a sparkline.', gaps: [],
                involved: [{ id: 'home-page', note: 'Shows the dashboard.', refs: [] }, { id: 'chart', note: 'Draws the chart.', refs: [] }],
                changes: { components: [
                    { id: 'proposal-spark', label: 'Sparkline', detail: '', tags: [], refs: [], status: 'new', rationale: 'Small trend line.' },
                    { id: 'chart', label: 'Chart', detail: 'Now lazy.', tags: [], refs: [], status: 'modified', rationale: 'Load on demand.' },
                ], uses: [{ from: 'home-page', to: 'proposal-spark', status: 'new', rationale: 'Shown under the total.' }] } },
        } as unknown as Trace;
        render(<ComponentsWorkspace vm={vm} />);
        act(() => vm.setTrace(trace));
        const graph = vm.graph;
        expect(graph.scope).toBe(TRACE);
        expect(graph.graph.nodes.map((n) => [n.id, (n as { status?: string }).status])).toEqual([
            ['home-page', undefined], ['chart', 'modified'], ['proposal-spark', 'new']]);
        expect(graph.graph.edges).toContainEqual({ from: 'home-page', to: 'proposal-spark', status: 'new' });
        expect((screen.getByLabelText('Show') as HTMLSelectElement).options[0].textContent).toBe('This trace');
        expect(screen.queryByRole('button', { name: 'Redraw' })).toBeNull();
        act(() => graph.pick('home-page'));
        const panel = screen.getByRole('complementary', { name: 'Component details' });
        expect(within(panel).getByRole('region', { name: 'Trace step' }).textContent).toContain('Shows the dashboard.');
        expect(within(panel).getByRole('region', { name: 'Proposed render links' }).textContent).toContain('HomePage renders Sparkline');
        fireEvent.click(within(panel).getByRole('button', { name: 'Next trace step' }));
        expect(graph.selectedId).toBe('chart');
        const change = within(screen.getByRole('complementary', { name: 'Component details' })).getByRole('region', { name: 'Proposed component change' });
        expect(change.textContent).toContain('Load on demand.');
        expect(change.textContent).toContain('Was: Chart');
        // back on the map: the repository components, all roots
        act(() => vm.setTrace(null));
        expect(graph.scope).toBe(ROOTS);
        expect(graph.graph.nodes.some((n) => n.id === 'proposal-spark')).toBe(false);
    });
    it('draws a trace’s missing Components output and saves the trace', async () => {
        const { vm, services } = fixture();
        await vm.load();
        const saveTrace = vi.fn().mockResolvedValue(undefined);
        (vm.deps as { saveTrace?: unknown }).saveTrace = saveTrace;
        vm.repo.bootstrap = { config: { name: '', columns: [] }, repo: {}, ai: { available: true, label: 'Test' } } as never;
        const trace = { intent: 'description', title: 'T', prompt: 'How does the dashboard load?', summary: '', gaps: '',
            steps: [], edges: [], refs: [], outputs: { architecture: true, flowchart: false, components: false },
            pendingFlow: false, pendingComponents: true } as unknown as Trace;
        act(() => vm.setTrace(trace));
        expect(vm.displayed).toBeNull();
        vi.mocked(services.api.stream).mockResolvedValueOnce({ type: 'result', components: {
            version: 1, applicability: 'relevant', summary: 'Two parts.', gaps: [], base: result.components,
            involved: [{ id: 'home-page', note: 'Loads data.', refs: [] }], changes: { components: [], uses: [] } } });
        await vm.generateTrace();
        expect(services.api.stream).toHaveBeenLastCalledWith('/api/trace/components', expect.objectContaining({ trace: expect.anything() }),
            expect.anything(), expect.any(Function));
        expect(trace.outputs.components).toBe(true);
        expect(trace.pendingComponents).toBe(false);
        expect(vm.graph.graph.nodes.map((n) => n.id)).toEqual(['home-page']);
        expect(saveTrace).toHaveBeenCalledWith(trace);
    });
    it('copies Mermaid and downloads SVG for the shown diagram', async () => {
        const { vm, services } = fixture();
        await vm.load();
        await vm.copyMermaid();
        expect(services.browser.copy).toHaveBeenCalledWith(expect.stringContaining('PriceLine'));
        vm.downloadSvg(() => '#000');
        expect(vi.mocked(services.browser.download).mock.calls[0][0]).toBe('components.svg');
    });
});

describe('Components search', () => {
    it('lists roots then the rest, matches tags and paths, and widens the scope to show a pick', async () => {
        const { vm } = fixture();
        await vm.load();
        const { container } = render(<ComponentsWorkspace vm={vm} />);
        const graph = vm.graph;
        act(() => graph.setScope('shop'));
        fireEvent.click(screen.getByRole('button', { name: /Search/ }));
        const results = screen.getByRole('listbox', { name: 'Matching components' });
        expect([...results.querySelectorAll('section h4')].map((h) => h.textContent)).toEqual(['Roots', 'Other components']);
        expect(graph.search.hits).toEqual(['home-page', 'shop-page', 'orphan', 'price', 'chart']);
        const input = screen.getByRole('combobox', { name: 'Find a component' });
        fireEvent.change(input, { target: { value: 'state' } });
        expect(graph.search.hits).toEqual(['home-page']);
        fireEvent.change(input, { target: { value: 'home.tsx' } });
        expect(graph.search.hits).toHaveLength(5);
        expect(container.querySelector('.fn[data-id="price"]')?.classList.contains('match')).toBe(true);
        fireEvent.change(input, { target: { value: 'chart' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(graph.selectedId).toBe('chart');
        expect(graph.scope).toBe(ROOTS);
        expect(screen.getByRole('button', { name: '← Results' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
        expect(container.querySelector('#component-details')).toBe(null);
        expect(graph.search.open).toBe(false);
    });
});

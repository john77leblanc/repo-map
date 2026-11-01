import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { RepositoryModel } from '../../models/RepositoryModel';
import type { ComponentMap, SitemapResult } from '../../models/types';
import type { Services } from '../../shared/services/contracts';
import { SitemapViewModel } from './SitemapViewModel';
import { SitemapWorkspace } from './SitemapWorkspace';

HTMLDialogElement.prototype.showModal = function () { this.open = true; };
HTMLDialogElement.prototype.close = function () { this.open = false; };

const result: SitemapResult = { status: { state: 'current' }, sitemap: {
    version: 1, applicability: 'applicable', summary: 'Two applications.', gaps: [],
    applications: [{ id: 'admin', label: 'Admin' }, { id: 'shop', label: 'Storefront' }],
    screens: [
        { id: 'home', app: 'admin', label: 'Dashboard', route: '/admin', detail: 'Management workspace.', refs: [] },
        { id: 'settings', app: 'admin', label: 'Settings', route: '', detail: 'Preferences.', refs: [] },
        { id: 'shop', app: 'shop', label: 'Shop', route: '/products/:id', detail: 'Products.', refs: [] },
    ], navigation: [
        { from: 'home', to: 'settings', label: 'Preferences', condition: 'Signed in', refs: [] },
        { from: 'home', to: 'shop', label: 'Visit store', condition: '', refs: [] },
    ],
} };
const ref = { path: 'src/Home.tsx', start: 1, end: 9 };
const componentMap: ComponentMap = { version: 1, applicability: 'applicable', summary: 'Pages.', gaps: [],
    components: [
        { id: 'home-page', label: 'HomePage', detail: '', tags: ['fetches'], refs: [ref] },
        { id: 'shop-page', label: 'ShopPage', detail: '', tags: [], refs: [ref] },
        { id: 'price', label: 'PriceLine', detail: '', tags: [], refs: [ref] },
    ],
    uses: [{ from: 'home-page', to: 'price' }, { from: 'shop-page', to: 'price' }],
    screens: [{ screen: 'home', root: 'home-page' }, { screen: 'shop', root: 'shop-page' }] };
function fixture({ map = null, showComponents }: { map?: ComponentMap | null; showComponents?: (screen: string, component?: string) => void } = {}) {
    const services: Services = {
        api: { get: vi.fn().mockResolvedValue(result), request: vi.fn(), stream: vi.fn().mockResolvedValue(result) },
        storage: { get: vi.fn(), set: vi.fn(), getRaw: vi.fn(), setRaw: vi.fn() },
        browser: { copy: vi.fn(), download: vi.fn(), reload: vi.fn() },
    };
    const repo = new RepositoryModel(services);
    const vm = new SitemapViewModel({ repo, services, components: () => map, showComponents });
    return { vm, services };
}
afterEach(cleanup);

describe('Sitemap', () => {
    it('collapses information and secondary actions, and reopens details when a screen is selected', async () => {
        const { vm, services } = fixture();
        await vm.load();
        const { container } = render(<SitemapWorkspace vm={vm} />);
        const more = screen.getByRole('button', { name: 'More' });
        fireEvent.click(more);
        const info = screen.getByRole('button', { name: 'Show info' });
        expect(info.getAttribute('aria-expanded')).toBe('false');
        expect(container.querySelector<HTMLElement>('#sitemap-info')!.hidden).toBe(true);
        fireEvent.click(info);
        expect(document.activeElement).toBe(more);
        expect(container.querySelector<HTMLElement>('#sitemap-info')!.hidden).toBe(false);
        expect(screen.getByText('Two applications.')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Refresh status' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'More' }));
        fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
        // the sitemap again
        await waitFor(() => expect(services.api.get).toHaveBeenCalledTimes(2));
        expect(screen.queryByRole('button', { name: 'Refresh status' })).toBeNull();
        // the screen panel is closed until a screen is picked, and More has no Show/Hide details
        fireEvent.click(more);
        expect(screen.queryByRole('button', { name: /details/ })).toBeNull();
        fireEvent.click(more);
        expect(screen.queryByRole('complementary', { name: 'Screen details' })).toBeNull();
        expect(container.querySelector('.sitemap-main.details-hidden')).toBeTruthy();
        fireEvent.keyDown(screen.getByRole('button', { name: 'Dashboard' }), { key: 'Enter' });
        expect(screen.getByRole('complementary', { name: 'Screen details' })).toBeTruthy();
        expect(container.querySelector('#sitemap-details-title')?.textContent).toBe('Dashboard');
        expect(container.querySelector('#sitemap-details .fside-kind .ft')?.textContent).toBe('Screen');
        // About, Navigation and References rows, all collapsed
        expect([...container.querySelectorAll('#sitemap-details .disclosure-head')]
            .map((h) => [h.querySelector('.disclosure-title')?.textContent, h.getAttribute('aria-expanded')]))
            .toEqual([['About', 'false'], ['Navigation', 'false']]);
        // Close hides the panel and clears the selection; picking a screen opens it again
        fireEvent.click(container.querySelector('#sitemap-details-close')!);
        expect(screen.queryByRole('complementary', { name: 'Screen details' })).toBeNull();
        expect(vm.selectedId).toBeNull();
        fireEvent.keyDown(screen.getByRole('button', { name: 'Dashboard' }), { key: 'Enter' });
        fireEvent.keyDown(screen.getByRole('complementary', { name: 'Screen details' }), { key: 'Escape' });
        expect(screen.queryByRole('complementary', { name: 'Screen details' })).toBeNull();
        fireEvent.keyDown(screen.getByRole('button', { name: 'Dashboard' }), { key: 'Enter' });
        fireEvent.click(more);
        fireEvent.keyDown(screen.getByRole('button', { name: 'Hide info' }), { key: 'Escape' });
        expect(more.getAttribute('aria-expanded')).toBe('false');
        expect(document.activeElement).toBe(more);
        fireEvent.click(more);
        fireEvent.pointerDown(document.body);
        expect(more.getAttribute('aria-expanded')).toBe('false');
        fireEvent.click(screen.getByRole('button', { name: 'Diagram key' }));
        expect(container.querySelector('#sitemap-key')?.hasAttribute('hidden')).toBe(false);
        expect(container.querySelector('#sitemap-key [data-proposal-key]')?.hasAttribute('hidden')).toBe(true);
        vm.dispose();
    });

    it('loads lazily, selects applications, and exposes cross-application navigation and conditions', async () => {
        const { vm, services } = fixture();
        expect(services.api.get).not.toHaveBeenCalled();
        await vm.load();
        expect(vm.appId).toBe('admin');
        const { container } = render(<SitemapWorkspace vm={vm} />);
        fireEvent.keyDown(screen.getByRole('button', { name: 'Dashboard' }), { key: 'Enter' });
        expect(screen.getByRole('heading', { name: 'Dashboard', level: 3 })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /^Navigation/ }));
        // flowchart-style rows: shape, screen name, the link drawn as an arrow, then its condition
        const row = container.querySelector('#sitemap-details .flow-conn button.cl[data-go="settings"]')!;
        expect(row.querySelector('svg.fshape')).toBeTruthy();
        expect(row.querySelector('b')?.textContent).toBe('Settings');
        expect(row.querySelector('.fl-arrow')?.textContent).toBe('Preferences');
        expect(row.querySelector('.cl-note')?.textContent).toBe('When: Signed in');
        expect(row.firstElementChild).toHaveClass('cl-arrow');
        expect(row.lastElementChild).toHaveClass('cl-note');
        expect(container.querySelector('#sitemap-details button.cl[data-go="shop"] b')?.textContent).toBe('Storefront: Shop');
        fireEvent.change(screen.getByLabelText('Application'), { target: { value: 'shop' } });
        expect(vm.selected).toBeNull();
        expect(vm.graph.nodes.map((node) => node.label)).toContain('Admin: Dashboard');
        expect(vm.graph.nodes.some((node) => node.id === 'settings')).toBe(false);
        vm.dispose();
    });
    it('shows a backend-only result and discloses dirty freshness', async () => {
        const { vm, services } = fixture();
        vi.mocked(services.api.get).mockResolvedValue({ status: { state: 'current', dirty: true }, sitemap: {
            ...result.sitemap, applicability: 'none', screens: [], applications: [], navigation: [], summary: 'Backend only.',
        } });
        await vm.load();
        render(<SitemapWorkspace vm={vm} />);
        expect(screen.getByText('No user-facing screens found')).toBeTruthy();
        expect(screen.getByText(/working tree has uncommitted/)).toBeTruthy();
        expect(vm.layout).toBeNull();
        expect((screen.getByRole('button', { name: 'Export' }) as HTMLButtonElement).disabled).toBe(true);
        vm.dispose();
    });
    it('has no generation button in the toolbar, and puts Search last on the right', async () => {
        const { vm } = fixture();
        await vm.load();
        const { container } = render(<SitemapWorkspace vm={vm} />);
        expect(screen.queryByRole('button', { name: /Regenerate|Generate sitemap/ })).toBeNull();
        expect(container.querySelector('#sitemap-redraw')).toBeNull();
        expect(container.querySelector('.flow-actions')?.lastElementChild?.id).toBe('sitemap-search-toggle');
        vm.dispose();
    });

    it('exports the application filter and clears copy feedback when the diagram changes', async () => {
        const { vm, services } = fixture();
        await vm.load();
        await vm.copyMermaid();
        expect(services.browser.copy).toHaveBeenLastCalledWith(expect.stringContaining('Settings'));
        expect(vm.copied).toBe(true);
        vm.selectApp('shop');
        expect(vm.copied).toBe(false);
        await vm.copyMermaid();
        const source = vi.mocked(services.browser.copy).mock.calls.at(-1)![0];
        expect(source).toContain('Admin: Dashboard');
        expect(source).not.toContain('Settings');
        vm.downloadSvg(() => '#123456');
        const [name, svg] = vi.mocked(services.browser.download).mock.calls[0];
        expect(name).toBe('sitemap.svg');
        expect(svg).toContain('Admin: Dashboard');
        expect(svg).not.toContain('Settings');
        expect(svg).not.toContain('var(--');
        expect(svg).toContain('fill="#123456"');
        expect(new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('parsererror')).toBeNull();
        vm.dispose();
    });

    it('reports clipboard failure and expires copied feedback', async () => {
        const { vm, services } = fixture();
        await vm.load();
        vi.mocked(services.browser.copy).mockRejectedValueOnce(new Error('Denied'));
        await vm.copyMermaid();
        expect(vm.message).toBe("Couldn't copy to the clipboard.");
        expect(vm.error).toBe(true);
        vi.useFakeTimers();
        try {
            await vm.copyMermaid();
            expect(vm.copied).toBe(true);
            vi.advanceTimersByTime(1500);
            expect(vm.copied).toBe(true);
            vi.advanceTimersByTime(500);
            expect(vm.copied).toBe(false);
        } finally {
            vm.dispose();
            vi.useRealTimers();
        }
    });
    it('generates on demand and keeps the last sitemap after failed regeneration', async () => {
        const { vm, services } = fixture();
        render(<SitemapWorkspace vm={vm} />);
        await act(() => vm.generate());
        await waitFor(() => expect(document.querySelector('#sitemap-status')?.textContent).toBe('Sitemap saved.'));
        expect(services.api.stream).toHaveBeenCalledWith('/api/sitemap/generate', {}, expect.any(AbortSignal), expect.any(Function));
        const saved = vm.sitemap;
        vi.mocked(services.api.stream).mockRejectedValueOnce(new Error('AI unavailable'));
        await act(() => vm.generate());
        await waitFor(() => expect(document.querySelector('#sitemap-status')?.textContent).toBe('AI unavailable'));
        expect(vm.sitemap).toBe(saved);
        vm.dispose();
    });
    it('ignores late results after stopping generation and supports retry', async () => {
        const { vm, services } = fixture();
        let resolve!: (value: SitemapResult) => void;
        vi.mocked(services.api.stream).mockImplementationOnce(() => new Promise<never>((done) => { resolve = done as unknown as typeof resolve; }));
        const pending = vm.generate();
        vm.stop();
        expect(vi.mocked(services.api.stream).mock.calls[0][2].aborted).toBe(true);
        resolve(result);
        await pending;
        expect(vm.sitemap).toBeNull();
        expect(vm.message).toBe('Stopped.');
        await vm.generate();
        expect(vm.sitemap).toEqual(result.sitemap);
        vm.dispose();
    });
    it('lists a screen\'s root components and opens them, or its tree, in the Components view', async () => {
        const showComponents = vi.fn();
        const { vm } = fixture({ map: componentMap, showComponents });
        await vm.load();
        render(<SitemapWorkspace vm={vm} />);
        // no diagram switch in the Sitemap toolbar any more
        expect(screen.queryByRole('group', { name: 'Diagram' })).toBeNull();
        fireEvent.keyDown(screen.getByRole('button', { name: 'Dashboard' }), { key: 'Enter' });
        const details = screen.getByRole('complementary', { name: 'Screen details' });
        fireEvent.click(within(details).getByRole('button', { name: /^Components/ }));
        const roots = within(details).getByRole('region', { name: 'Root components' });
        expect(within(roots).getAllByRole('button').map((b) => b.textContent)).toEqual(['HomePagefetches']);
        expect(details.textContent).toContain('2 components in all');
        fireEvent.click(within(roots).getByRole('button', { name: /HomePage/ }));
        expect(showComponents).toHaveBeenLastCalledWith('home', 'home-page');
        // the tree window: names and tags only; rows and Show in diagram go to the Components view
        fireEvent.click(within(details).getByRole('button', { name: 'View component tree' }));
        expect(vm.treeScreenId).toBe('home');
        const dialog = screen.getByRole('dialog', { name: 'Dashboard components' });
        const tree = within(dialog).getByRole('list', { name: 'Components on this screen' });
        expect(tree.textContent).toContain('PriceLine');
        expect(tree.textContent).not.toContain('screens');
        expect(tree.textContent).not.toContain('Home.tsx');
        expect(within(tree).getAllByRole('button').map((b) => b.getAttribute('aria-label')))
            .toEqual(['Show HomePage in the Components diagram', 'Show PriceLine in the Components diagram']);
        fireEvent.click(within(tree).getByRole('button', { name: 'Show PriceLine in the Components diagram' }));
        expect(vm.treeOpen).toBe(false);
        expect(showComponents).toHaveBeenLastCalledWith('home', 'price');
        fireEvent.click(within(details).getByRole('button', { name: 'View component tree' }));
        fireEvent.click(within(screen.getByRole('dialog', { name: 'Dashboard components' })).getByRole('button', { name: 'Show in diagram' }));
        expect(vm.treeOpen).toBe(false);
        expect(showComponents).toHaveBeenLastCalledWith('home', undefined);
    });
    it('shows a hint for a screen with no components, and no components section in a trace', async () => {
        const { vm } = fixture({ map: componentMap });
        await vm.load();
        render(<SitemapWorkspace vm={vm} />);
        fireEvent.keyDown(screen.getByRole('button', { name: 'Settings' }), { key: 'Enter' });
        const details = screen.getByRole('complementary', { name: 'Screen details' });
        fireEvent.click(within(details).getByRole('button', { name: /^Components/ }));
        expect(details.textContent).toContain('No components were linked to this screen.');
        expect(within(details).queryByRole('button', { name: 'View component tree' })).toBeNull();
        act(() => vm.setTrace({ intent: 'description' } as never));
        expect(vm.components).toBeNull();
    });
    it('opens a screen from another application', async () => {
        const { vm } = fixture();
        await vm.load();
        expect(vm.appId).toBe('admin');
        act(() => vm.openScreen('shop'));
        expect(vm.appId).toBe('shop');
        expect(vm.selectedId).toBe('shop');
        expect(vm.detailsOpen).toBe(true);
    });
});

describe('Sitemap search', () => {
    it('finds screens on the diagram by application, opens one, and steps back with Escape', async () => {
        const { vm } = fixture();
        await vm.load();
        const { container } = render(<SitemapWorkspace vm={vm} />);
        fireEvent.click(screen.getByRole('button', { name: /Search/ }));
        const results = screen.getByRole('listbox', { name: 'Matching screens' });
        expect([...results.querySelectorAll('section h4')].map((h) => h.textContent)).toEqual(['Admin', 'Storefront']);
        expect([...results.querySelectorAll('[role=option]')].map((o) => o.textContent)).toEqual(['Dashboard', 'Settings', 'Shop']);
        const input = screen.getByRole('combobox', { name: 'Find a screen' });
        fireEvent.change(input, { target: { value: 'products' } });
        expect(vm.search.hits).toEqual(['shop']);
        expect(container.querySelector('.fn[data-id="shop"]')?.classList.contains('match')).toBe(true);
        expect(container.querySelector('.fn[data-id="home"]')?.classList.contains('match')).toBe(false);
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(vm.selectedId).toBe('shop');
        expect(screen.getByRole('complementary', { name: 'Screen details' })).toBeTruthy();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(vm.selectedId).toBe(null);
        expect(screen.getByRole('listbox', { name: 'Matching screens' })).toBeTruthy();
        fireEvent.click(screen.getByRole('option', { name: 'Shop' }));
        fireEvent.click(screen.getByRole('button', { name: '← Results' }));
        expect(screen.getByRole('listbox', { name: 'Matching screens' })).toBeTruthy();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(container.querySelector('#sitemap-details')).toBe(null);
        expect(vm.search.query).toBe('');
        vm.dispose();
    });
    it('opens with "/" and lists only screens that are drawn', async () => {
        const { vm } = fixture();
        await vm.load();
        render(<SitemapWorkspace vm={vm} />);
        act(() => vm.selectApp('shop'));
        fireEvent.keyDown(document, { key: '/' });
        expect(vm.search.open).toBe(true);
        // Storefront draws Shop and Dashboard (which links to it); Settings is not on the diagram.
        expect(vm.search.hits).toEqual(['home', 'shop']);
        vm.dispose();
    });
});

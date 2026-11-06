import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RepositoryModel } from '../../models/RepositoryModel';
import type { Services } from '../../shared/services/contracts';
import type { Sitemap } from '../../models/types';
import { SitemapViewModel } from '../sitemap/SitemapViewModel';
import { ComponentsViewModel } from '../components/ComponentsViewModel';
import { SettingsViewModel } from './SettingsViewModel';
import { SettingsPanel } from './SettingsView';

afterEach(cleanup);

const sitemap: Sitemap = {
    version: 1, applicability: 'applicable', summary: 'One screen.', gaps: [],
    applications: [{ id: 'shop', label: 'Shop' }],
    screens: [{ id: 'home', app: 'shop', label: 'Home', route: '/', detail: '', refs: [] }],
    navigation: [],
};

function setup({ withSitemap = true } = {}) {
    const stream = vi.fn(() => new Promise(() => {}));
    const services = {
        api: {
            get: vi.fn((url: string) => Promise.resolve(url === '/api/sitemap'
                ? { status: { state: withSitemap ? 'current' : 'missing' }, sitemap: withSitemap ? sitemap : null }
                : url === '/api/components' ? { status: { state: 'missing' }, components: null } : {})),
            request: vi.fn(() => new Promise(() => {})),
            stream,
        },
        storage: { get: <T,>(_key: string, fallback: T) => fallback, set: vi.fn(), getRaw: () => null, setRaw: vi.fn() },
        browser: { copy: vi.fn(), download: vi.fn(), reload: vi.fn() },
        exporter: { fontFace: vi.fn(async () => ''), png: vi.fn(async () => new Blob(['png'])), pdf: vi.fn(async () => new Blob(['pdf'])) },
    } as unknown as Services;
    const repo = new RepositoryModel(services);
    repo.bootstrap = { config: { name: 'Test', columns: [] }, repo: {}, ai: { available: true, label: 'AI' } };
    const sitemapVm = new SitemapViewModel({ repo, services });
    const components = new ComponentsViewModel({ repo, services, sitemap: () => sitemapVm.sitemap });
    const settings = new SettingsViewModel({ repo, services, sitemap: sitemapVm, components });
    settings.mapStatus = { state: 'current', commit: 'abc1234567' };
    return { settings, sitemap: sitemapVm, components, stream };
}

describe('Settings → Map → Views', () => {
    it('lists Architecture, Sitemap and Components, each with its state and button', async () => {
        const { settings } = setup();
        render(<SettingsPanel vm={settings} />);
        const views = screen.getByRole('region', { name: 'Views' });
        await waitFor(() => expect(within(views).getByRole('region', { name: 'Sitemap' }).textContent).toContain('Current at recorded commit.'));
        const architecture = within(views).getByRole('region', { name: 'Architecture' });
        expect(architecture.textContent).toContain('Up to date with the code');
        expect(within(architecture).getByRole('button', { name: 'Redraw map' })).toBeTruthy();
        expect(within(views).getByRole('button', { name: 'Regenerate sitemap' })).toBeEnabled();
        const components = within(views).getByRole('region', { name: 'Components' });
        expect(components.textContent).toContain('Not generated yet.');
        expect(within(components).getByRole('button', { name: 'Generate components' })).toBeEnabled();
    });
    it('asks to confirm before replacing the sitemap, then shows the job with Stop', async () => {
        const { settings, sitemap, stream } = setup();
        render(<SettingsPanel vm={settings} />);
        const button = await screen.findByRole('button', { name: 'Regenerate sitemap' });
        await waitFor(() => expect(button).toBeEnabled());
        fireEvent.click(button);
        expect(button.textContent).toBe('Confirm regenerate');
        expect(stream).not.toHaveBeenCalled();
        fireEvent.click(button);
        expect(stream).toHaveBeenCalledWith('/api/sitemap/generate', {}, expect.anything(), expect.any(Function));
        expect(sitemap.busy).toBe(true);
        const row = screen.getByRole('region', { name: 'Sitemap' });
        fireEvent.click(within(row).getByRole('button', { name: 'Stop' }));
        expect(sitemap.busy).toBe(false);
        expect(row.textContent).toContain('Stopped.');
    });
    it('needs the sitemap before components, and generates without a confirm when nothing exists', async () => {
        const { settings, components, stream } = setup({ withSitemap: false });
        render(<SettingsPanel vm={settings} />);
        const row = screen.getByRole('region', { name: 'Components' });
        await waitFor(() => expect(row.textContent).toContain('Needs the sitemap first'));
        expect(within(row).getByRole('button', { name: 'Generate components' })).toBeDisabled();
        act(() => settings.redrawComponents());
        expect(components.busy).toBe(false);
        fireEvent.click(await screen.findByRole('button', { name: 'Generate sitemap' }));
        expect(stream).toHaveBeenCalledWith('/api/sitemap/generate', {}, expect.anything(), expect.any(Function));
    });
});

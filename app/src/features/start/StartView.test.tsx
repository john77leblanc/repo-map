import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RepositoryModel } from '../../models/RepositoryModel';
import type { Services } from '../../shared/services/contracts';
import { SettingsViewModel } from '../settings/SettingsViewModel';
import type { Catalog } from '../settings/SettingsViewModel';
import { SitemapViewModel } from '../sitemap/SitemapViewModel';
import { StartViewModel } from './StartViewModel';
import { StartView } from './StartView';

const catalog: Catalog = {
    agents: [{ id: 'codex', label: 'Codex CLI', available: true, defaultModel: 'gpt-6.1-sol', models: [], efforts: ['low'] }],
    default: { agent: 'codex' },
    generate: { agent: 'codex' },
    generateSet: false,
};
const node = { id: 'app', group: 'g', kind: 'service', path: 'src' };
const setupInfo = { name: 'shop map', codeRoots: ['src/'], context: '', dirs: [{ path: 'scripts/', suggested: false }, { path: 'src/', suggested: true }] };

type Pending = { url: string; signal: AbortSignal; progress: (text: string) => void; resolve: (value: unknown) => void; reject: (e: unknown) => void };

function fixture() {
    const values = new Map<string, unknown>();
    const services: Services = {
        api: { get: vi.fn(), request: vi.fn().mockResolvedValue({}), stream: vi.fn() },
        storage: {
            get: <T,>(key: string, fallback: T) => (values.has(key) ? (values.get(key) as T) : fallback),
            set: (key, value) => { values.set(key, value); },
            getRaw: (key) => (values.get(key) as string) || null,
            setRaw: (key, value) => { values.set(key, value); },
        },
        browser: { copy: vi.fn(), download: vi.fn(), reload: vi.fn() },
        exporter: { fontFace: vi.fn(async () => ''), png: vi.fn(async () => new Blob(['png'])), pdf: vi.fn(async () => new Blob(['pdf'])) },
    };
    const repo = new RepositoryModel(services);
    repo.bootstrap = { config: { name: 'shop', columns: [] }, repo: {}, ai: { available: true, label: 'AI' } };
    repo.ready = true;
    return { services, repo };
}

function setup() {
    const f = fixture();
    const settings = new SettingsViewModel(f);
    settings.data = catalog;
    const sitemap = new SitemapViewModel(f);
    const streams: Pending[] = [];
    vi.mocked(f.services.api.stream).mockImplementation((url, _body, signal, progress) =>
        new Promise((resolve, reject) => {
            streams.push({ url, signal, progress, resolve, reject });
            signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }) as never);
    // repo.load and status reloads after a job
    vi.mocked(f.services.api.get).mockImplementation(async (url: string) => {
        if (url === '/api/config') return f.repo.bootstrap;
        if (url === '/api/map') return { groups: [], edges: [], nodes: [node] };
        if (url === '/api/setup') return setupInfo;
        if (url.startsWith('/api/agents')) return settings.data;
        return {};
    });
    const vm = new StartViewModel({ repo: f.repo, services: f.services, settings, sitemap });
    return { ...f, vm, settings, sitemap, streams };
}

describe('StartViewModel', () => {
    it('is shown while the map is empty, with the sitemap opt-in off', () => {
        const { vm } = setup();
        expect(vm.visible).toBe(true);
        expect(vm.includeSitemap).toBe(false);
        expect(vm.canBuild).toBe(true);
    });

    it('builds only the map unless the sitemap is ticked', async () => {
        const { vm, streams } = setup();
        void vm.build();
        expect(streams.map((s) => s.url)).toEqual(['/api/map/generate']);
        expect(vm.sitemapState).toBe('idle');
    });

    it('runs map and sitemap in parallel with separate progress', async () => {
        const { vm, streams, repo } = setup();
        vm.setIncludeSitemap(true);
        const done = vm.build();
        expect(streams.map((s) => s.url)).toEqual(['/api/map/generate', '/api/sitemap/generate']);
        expect(vm.mapState).toBe('running');
        expect(vm.sitemapState).toBe('running');
        streams[0].progress('Reading the map');
        streams[1].progress('Reading screens');
        expect(vm.mapMessage).toBe('Reading the map');
        expect(vm.mapLog.entries.map((e) => e.text)).toEqual(['Starting…', 'Reading the map']);
        expect(vm.sitemapLog.entries.map((e) => e.text)).toEqual(['Starting sitemap analysis…', 'Reading screens']);
        expect(vm.sitemapMessage).toBe('Reading screens');
        // the map finishes first: the screen stays while the sitemap runs
        streams[0].resolve({ check: { counts: { nodes: 1, edges: 0 } } });
        await vi.waitFor(() => expect(repo.map.nodes.length).toBe(1));
        expect(vm.mapState).toBe('done');
        expect(vm.visible).toBe(true);
        vm.openMap();
        expect(vm.visible).toBe(false);
        expect(vm.sitemapState).toBe('running');
        streams[1].resolve({ sitemap: { applications: [], screens: [], navigation: [], gaps: [] }, status: { state: 'current' } });
        await done;
        expect(vm.sitemapState).toBe('done');
    });

    it('stopping one job leaves the other running', async () => {
        const { vm, streams } = setup();
        vm.setIncludeSitemap(true);
        void vm.build();
        vm.stopMap();
        await vi.waitFor(() => expect(vm.mapState).toBe('idle'));
        expect(vm.mapMessage).toBe('Stopped.');
        expect(streams[0].signal.aborted).toBe(true);
        expect(streams[1].signal.aborted).toBe(false);
        expect(vm.sitemapState).toBe('running');
    });

    it('reports a failed map run and allows retry', async () => {
        const { vm, streams } = setup();
        void vm.build();
        streams[0].reject(new Error('limit reached'));
        await vi.waitFor(() => expect(vm.mapState).toBe('error'));
        expect(vm.mapMessage).toBe('limit reached');
        vm.retryMap();
        expect(streams).toHaveLength(2);
        expect(vm.mapState).toBe('running');
    });

    it('starts from folders without AI', async () => {
        const { vm, services, repo } = setup();
        await vm.useFolders();
        expect(services.api.request).toHaveBeenCalledWith('/api/map/starter', { method: 'POST' });
        expect(repo.map.nodes.length).toBe(1);
        expect(vm.visible).toBe(false);
    });

    it('cannot build without an AI tool', () => {
        const { vm, settings } = setup();
        settings.data = { ...catalog, generate: null, generateReason: 'No AI tool found.' } as Catalog;
        expect(vm.canBuild).toBe(false);
        expect(vm.noAi).toBe('No AI tool found.');
    });
});

describe('onboarding steps', () => {
    it('loads the project details and saves them before the AI step', async () => {
        const { vm, services } = setup();
        expect(vm.step).toBe('project');
        await vm.loadSetup();
        expect(vm.name).toBe('shop map');
        expect(vm.roots).toEqual(['src/']);
        expect(vm.folderOptions).toEqual(['scripts/', 'src/']);
        vm.toggleRoot('scripts/', true);
        vm.setCustomFolder(' ./packages/api ');
        vm.addFolder();
        vm.setContext('A shop.');
        await vm.saveProject();
        expect(services.api.request).toHaveBeenCalledWith('/api/setup', {
            method: 'PUT',
            body: JSON.stringify({ name: 'shop map', codeRoots: ['src/', 'scripts/', 'packages/api/'], context: 'A shop.' }),
        });
        expect(vm.step).toBe('ai');
    });

    it('needs a name and a folder', async () => {
        const { vm } = setup();
        await vm.loadSetup();
        vm.toggleRoot('src/', false);
        expect(vm.canSaveProject).toBe(false);
        vm.toggleRoot('src/', true);
        vm.setName('  ');
        expect(vm.canSaveProject).toBe(false);
    });

    it('stays on the step and shows the server error when saving fails', async () => {
        const { vm, services } = setup();
        await vm.loadSetup();
        vi.mocked(services.api.request).mockRejectedValueOnce(new Error('There is no folder'));
        await vm.saveProject();
        expect(vm.step).toBe('project');
        expect(vm.stepError).toBe('There is no folder');
    });

    it('saves the trace tool as the default, then moves to Build', async () => {
        const { vm, services, settings } = setup();
        vm.step = 'ai';
        settings.setTracePick({ agent: 'codex', effort: 'low' });
        await vm.saveAi();
        expect(services.api.request).toHaveBeenCalledWith('/api/settings/trace', {
            method: 'PUT',
            body: JSON.stringify({ agent: 'codex', effort: 'low' }),
        });
        expect(vm.step).toBe('build');
        vm.back();
        expect(vm.step).toBe('ai');
    });

    it('can give the map its own tool', () => {
        const { vm, settings, services } = setup();
        settings.setTracePick({ agent: 'codex' });
        expect(vm.sameForMap).toBe(true);
        vm.setSameForMap(false);
        expect(vm.sameForMap).toBe(false);
        expect(services.api.request).toHaveBeenCalledWith('/api/settings/generate', expect.objectContaining({ method: 'PUT', body: expect.stringContaining('"agent":"codex"') }));
        vm.setSameForMap(true);
        expect(vm.sameForMap).toBe(true);
    });

    it('goes on without AI when no tool is found', async () => {
        const { vm, settings, services } = setup();
        vm.step = 'ai';
        settings.data = { agents: [], generate: null, generateReason: 'No AI tool found.' } as Catalog;
        await vm.saveAi();
        expect(vm.step).toBe('build');
        expect(services.api.request).not.toHaveBeenCalled();
        expect(vm.canBuild).toBe(false);
    });
});

describe('StartView', () => {
    it('starts on the project step with the detected folders', async () => {
        const { vm } = setup();
        render(<StartView vm={vm} />);
        expect(screen.getByRole('heading', { name: 'Set up repo-map' })).toBeInTheDocument();
        await screen.findByDisplayValue('shop map');
        expect(screen.getByRole('checkbox', { name: /^src\// })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: /^scripts\// })).not.toBeChecked();
        expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
    });

    it('shows install help on the AI step when no tool is found', () => {
        const { vm, settings } = setup();
        settings.data = { agents: [], generate: null, generateReason: 'No AI tool found.' } as Catalog;
        vm.step = 'ai';
        render(<StartView vm={vm} />);
        expect(screen.getByText(/No AI tool found on this machine/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Continue without AI' }));
        expect(screen.getByRole('button', { name: 'Build' })).toBeDisabled();
    });

    it('renders an unchecked sitemap box and Build on the last step', () => {
        const { vm } = setup();
        vm.step = 'build';
        render(<StartView vm={vm} />);
        expect(screen.getByRole('checkbox', { name: /Also build the sitemap/ })).not.toBeChecked();
        expect(screen.getByRole('button', { name: 'Build' })).toBeEnabled();
    });
});

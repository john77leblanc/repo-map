import { describe, expect, it, vi, afterEach } from 'vitest';
import { RepositoryModel } from '../../models/RepositoryModel';
import type { Services } from '../../shared/services/contracts';
import { SettingsViewModel, mapNoticeKey } from './SettingsViewModel';
import type { Catalog } from './SettingsViewModel';
export function fixture() {
    const values = new Map<string, unknown>();
    const services: Services = {
        api: { get: vi.fn(), request: vi.fn().mockResolvedValue({}), stream: vi.fn() },
        storage: {
            get: <T>(key: string, fallback: T) =>
                values.has(key) ? (values.get(key) as T) : fallback,
            set: (key, value) => {
                values.set(key, value);
            },
            getRaw: (key) => (values.get(key) as string) || null,
            setRaw: (key, value) => {
                values.set(key, value);
            },
        },
        browser: { copy: vi.fn(), download: vi.fn(), reload: vi.fn() },
    };
    const repo = new RepositoryModel(services);
    repo.bootstrap = {
        config: { name: 'shop', columns: [] },
        repo: {},
        ai: { available: false, label: 'AI' },
    };
    repo.ready = true;
    return { services, repo, values };
}
const catalog: Catalog = {
    agents: [
        {
            id: 'codex',
            label: 'Codex CLI',
            available: true,
            defaultModel: 'gpt-6.1-sol',
            models: [],
            efforts: ['low'],
        },
    ],
    default: { agent: 'codex', model: 'gpt-6.1-sol', effort: 'low' },
    generate: { agent: 'codex' },
    generateSet: false,
};
afterEach(() => vi.useRealTimers());
describe('SettingsViewModel', () => {
    it('ignores stale catalog answers when a refresh finishes first', async () => {
        const f = fixture();
        const answers: ((value: Catalog) => void)[] = [];
        vi.mocked(f.services.api.get).mockImplementation(
            () =>
                new Promise((r) => {
                    answers.push(r as (value: Catalog) => void);
                })
        );
        const vm = new SettingsViewModel(f);
        const old = vm.loadCatalog();
        const fresh = vm.loadCatalog(true);
        answers[1](catalog);
        await fresh;
        answers[0]({ agents: [], off: true });
        await old;
        expect(vm.available).toBe(true);
        expect(vm.loading).toBe(false);
        vm.dispose();
    });

    it('loads shared catalog and honors repository-scoped trace selection', async () => {
        const f = fixture();
        f.values.set('repomap:shop:pick', { agent: 'codex', model: 'custom', effort: 'low' });
        vi.mocked(f.services.api.get).mockImplementation(async (url) =>
            url === '/api/agents'
                ? catalog
                : ({ state: 'current', docs: { linked: true } } as never)
        );
        const vm = new SettingsViewModel(f);
        await vm.init();
        expect(vm.available).toBe(true);
        expect(vm.currentPick()).toEqual({ agent: 'codex', model: 'custom', effort: 'low' });
        expect(vm.pickLabel()).toBe('Codex CLI · custom · low');
        expect(vm.mapPick).toBeNull();
        vm.dispose();
    });
    it('matches the legacy notification bytes, storage key, and issue dismissal', () => {
        const f = fixture(),
            vm = new SettingsViewModel(f);
        vm.mapStatus = {
            state: 'stale',
            commit: 'abc',
            changed: 2,
            files: ['a'],
            docs: { linked: true, changed: 1, files: ['guide'], commit: null },
        };
        const key =
            '{"state":"stale","commit":"abc","reason":"","changed":2,"files":["a"],"docs":{"linked":true,"changed":1,"files":["guide"],"commit":""}}';
        expect(mapNoticeKey(vm.mapStatus)).toBe(key);
        expect(vm.notice).toBe(true);
        vm.dismissNotice();
        expect(f.values.get('repomap:shop:dismissed-map-notice')).toBe(key);
        expect(vm.notice).toBe(false);
        vm.mapStatus = { ...vm.mapStatus, changed: 3 };
        expect(vm.notice).toBe(true);
        vm.dispose();
    });
    it('saves inheritance as an empty generate object', async () => {
        const f = fixture();
        vi.mocked(f.services.api.get).mockResolvedValue(catalog);
        const vm = new SettingsViewModel(f);
        await vm.setMapPick(null);
        expect(f.services.api.request).toHaveBeenCalledWith(
            '/api/settings/generate',
            expect.objectContaining({ method: 'PUT', body: '{}' })
        );
        expect(vm.saveError).toBe(false);
        vm.dispose();
    });
    it('requires redraw confirmation and clears scheduled reload on disposal', async () => {
        vi.useFakeTimers();
        const f = fixture();
        vi.mocked(f.services.api.stream).mockResolvedValue({ check: { counts: { nodes: 3 } } });
        const vm = new SettingsViewModel(f);
        vm.mapStatus = { state: 'current' };
        vm.redraw();
        expect(vm.redrawArmed).toBe(true);
        expect(f.services.api.stream).not.toHaveBeenCalled();
        vm.redraw();
        await Promise.resolve();
        expect(f.services.api.stream).toHaveBeenCalledTimes(1);
        vm.dispose();
        await vi.runAllTimersAsync();
        expect(f.services.browser.reload).not.toHaveBeenCalled();
    });
    it('aborts catalog requests and ignores late answers after disposal', async () => {
        const f = fixture();
        let resolve!: (value: Catalog) => void;
        vi.mocked(f.services.api.get).mockImplementation(
            () =>
                new Promise((r) => {
                    resolve = r as typeof resolve;
                })
        );
        const vm = new SettingsViewModel(f);
        const pending = vm.loadCatalog();
        const signal = vi.mocked(f.services.api.get).mock.calls[0][1];
        vm.dispose();
        resolve(catalog);
        await pending;
        expect(signal?.aborted).toBe(true);
        expect(vm.data).toBeNull();
    });
});

import { vi } from 'vitest';
import { RepositoryModel } from '../../models/RepositoryModel';
import type { Services } from '../../shared/services/contracts';
import type { TraceDependencies } from './TraceViewModel';
export function fixture() {
    const storage = new Map<string, string>();
    const services: Services = {
        api: {
            get: vi.fn(async () => ({ traces: [] })) as Services['api']['get'],
            request: vi.fn(async () => ({ key: 'saved' })) as Services['api']['request'],
            stream: vi.fn(),
        },
        storage: {
            get: (_k, fallback) => fallback,
            set: vi.fn(),
            getRaw: (k) => storage.get(k) ?? null,
            setRaw: (k, v) => {
                storage.set(k, v);
            },
        },
        browser: { copy: vi.fn(async () => {}), download: vi.fn(), reload: vi.fn() },
        exporter: { fontFace: vi.fn(async () => ''), png: vi.fn(async () => new Blob(['png'])), pdf: vi.fn(async () => new Blob(['pdf'])) },
    };
    const repo = new RepositoryModel(services);
    repo.bootstrap = {
        config: { name: 'test', columns: [] },
        repo: {},
        ai: { available: true, label: 'Test' },
    };
    repo.map = {
        groups: [{ id: 'shop', col: 0, title: 'Shop' }],
        nodes: [{ id: 'checkout', group: 'shop', kind: 'service', title: 'Checkout' }],
        edges: [],
    };
    const deps: TraceDependencies = {
        repo,
        services,
        getPick: () => ({ agent: 'api' }),
        getPickLabel: () => 'Test',
        getWorkspace: () => 'flowchart',
        onSelect: vi.fn(),
        onClear: vi.fn(),
        onReveal: vi.fn(),
        onOpenPlan: vi.fn(),
        onRequestFlow: vi.fn(),
    };
    return { deps, repo, services, storage };
}
export const raw = {
    title: 'Checkout',
    steps: [{ id: 'checkout', note: 'Place order' }],
    refs: [],
};
export const flow = {
    nodes: [
        { id: 'start', type: 'start', label: 'Start', step: 1 },
        { id: 'end', type: 'end', label: 'Done' },
    ],
    edges: [{ from: 'start', to: 'end' }],
};

import { vi } from 'vitest';
import { RepositoryModel } from '../../models/RepositoryModel';
import type { Services } from '../../shared/services/contracts';
import type { Trace } from '../../models/types';
import { ArchitectureViewModel } from './ArchitectureViewModel';

export function fixture() {
    const services: Services = {
        api: { get: vi.fn(), request: vi.fn(), stream: vi.fn() },
        storage: {
            get: (_key, fallback) => fallback,
            set: vi.fn(),
            getRaw: () => null,
            setRaw: vi.fn(),
        },
        browser: { copy: vi.fn(), download: vi.fn(), reload: vi.fn() },
        exporter: { fontFace: vi.fn(async () => ''), png: vi.fn(async () => new Blob(['png'])), pdf: vi.fn(async () => new Blob(['pdf'])) },
    };
    const repo = new RepositoryModel(services);
    repo.bootstrap = {
        config: { name: 'Test', columns: [{ title: 'Code' }] },
        repo: {},
        ai: { available: false, label: '' },
    };
    repo.map = {
        groups: [
            { id: 'a', col: 0, title: 'Alpha', open: true },
            { id: 'b', col: 0, title: 'Beta' },
        ],
        nodes: [
            { id: 'one', title: 'One', group: 'a', kind: 'service' },
            { id: 'two', title: 'Two', group: 'b', kind: 'service' },
        ],
        edges: [{ from: 'one', to: 'two', type: 'http' }],
    };
    const vm = new ArchitectureViewModel({ repo, services });
    const trace: Trace = {
        intent: 'description',
        title: 'Trace',
        prompt: '',
        summary: '',
        gaps: '',
        steps: [{ id: 'two', note: 'Second' }],
        edges: [['one', 'two']],
        refs: [],
        outputs: { architecture: true, flowchart: false },
        pendingFlow: false,
    };
    return { vm, repo, services, trace };
}

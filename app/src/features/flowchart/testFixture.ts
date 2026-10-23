import { vi } from 'vitest';
import { RepositoryModel } from '../../models/RepositoryModel';
import type { Trace, StreamResult } from '../../models/types';
import type { Services } from '../../shared/services/contracts';
import { FlowchartViewModel } from './FlowchartViewModel';

export function fixture() {
    const flow = {
        nodes: [
            { id: 'a', type: 'decision', label: 'Ready?', step: 1 },
            { id: 'b', type: 'end', label: 'Done', inferred: true },
        ],
        edges: [{ from: 'a', to: 'b', label: 'yes' }],
    };
    const trace: Trace = {
        intent: 'description',
        title: 'Checkout',
        prompt: '',
        summary: '',
        gaps: '',
        steps: [{ id: 'checkout', note: '' }],
        edges: [],
        refs: [{ path: 'main.ts', start: 1, end: 2, step: 'checkout' }],
        outputs: { architecture: true, flowchart: true },
        pendingFlow: false,
        flow,
    };
    const services: Services = {
        api: { get: vi.fn(), request: vi.fn(), stream: vi.fn().mockResolvedValue({ flow }) },
        browser: { copy: vi.fn().mockResolvedValue(undefined), download: vi.fn(), reload: vi.fn() },
        storage: { get: vi.fn(), set: vi.fn(), getRaw: vi.fn(), setRaw: vi.fn() },
    };
    const repo = Object.assign(Object.create(RepositoryModel.prototype) as RepositoryModel, {
        services,
        bootstrap: null,
        map: { nodes: [], edges: [], groups: [] },
    });
    repo.docs = { checkout: [{ path: 'README.md', start: 3, end: 4, kind: 'guide' }] };
    const saveTrace = vi.fn().mockResolvedValue(undefined);
    const onTraceUpdated = vi.fn();
    const vm = new FlowchartViewModel({
        repo,
        services,
        getPick: () => ({ agent: 'codex' }),
        saveTrace,
        onTraceUpdated,
    });
    return { vm, trace, services, saveTrace, onTraceUpdated, flow };
}

import { describe, expect, it, vi } from 'vitest';
import { TraceViewModel } from './TraceViewModel';
import { normalizeTrace, plain } from '../../models/trace';
import type { WorkspaceMap } from '../../models/trace';
import { fixture } from './testFixtures';

/** The test repo plus a linked "api" repo; the placeholder "orders-ext" is explained by a seam. */
const merged: WorkspaceMap = {
    groups: [{ id: 'shop', col: 0, title: 'Shop' }, { id: 'api:svc', col: 1, title: 'Services' }],
    nodes: [
        { id: 'checkout', group: 'shop', kind: 'service', title: 'Checkout' },
        { id: 'api:orders-route', group: 'api:svc', kind: 'service', title: 'Orders route' },
    ],
    edges: [{ from: 'checkout', to: 'api:orders-route', type: 'http' }],
    replaced: { 'orders-ext': 'api:orders-route' },
};

const workspaceTrace = {
    scope: 'workspace',
    repos: ['home', 'api', 'Bad Name'],
    title: 'Order',
    steps: [
        { id: 'checkout', note: 'posts' },
        { id: 'orders-ext', note: 'the placeholder' },
        { id: 'api:orders-route', note: 'duplicate after the swap' },
        { id: 'gone:worker', note: 'repo no longer linked' },
        { id: 'unknown-card', note: 'dropped' },
    ],
    refs: [{ step: 'orders-ext', path: 'api:src/routes/orders.js', start: 1, end: 4 }],
    edges: [['checkout', 'orders-ext']],
};

describe('workspace traces', () => {
    it('reads prefixed ids on the merged map, swaps replaced placeholders and keeps unlinked steps', () => {
        const { repo } = fixture();
        const trace = normalizeTrace(workspaceTrace, repo.map, undefined, merged);
        expect(trace.scope).toBe('workspace');
        expect(trace.repos).toEqual(['home', 'api']);
        expect(trace.steps.map((s) => s.id)).toEqual(['checkout', 'api:orders-route', 'gone:worker']);
        expect(trace.refs).toEqual([{ step: 'api:orders-route', path: 'api:src/routes/orders.js', start: 1, end: 4, why: '' }]);
        expect(trace.edges).toEqual([['checkout', 'api:orders-route']]);
        expect(plain(trace)).toMatchObject({ scope: 'workspace', repos: ['home', 'api'] });
        // without the scope, the home map applies and prefixed ids are dropped
        const home = normalizeTrace({ ...workspaceTrace, scope: undefined }, repo.map, undefined, merged);
        expect(home.scope).toBeUndefined();
        expect(home.steps.map((s) => s.id)).toEqual(['checkout']);
    });

    it('names steps by repo and lists repos that are no longer linked', () => {
        const { deps } = fixture();
        deps.getWorkspaceMap = () => merged;
        deps.getRepoTitles = () => ({ home: 'Shop', api: 'Shop API' });
        const vm = new TraceViewModel(deps);
        const trace = normalizeTrace(workspaceTrace, deps.repo.map, undefined, merged);
        expect(vm.stepTitle(trace, 'checkout')).toBe('Checkout');
        expect(vm.stepTitle(trace, 'api:orders-route')).toBe('Orders route (Shop API)');
        expect(vm.stepTitle(trace, 'gone:worker')).toBe('worker (from gone, not linked)');
        expect(vm.unlinkedRepos(trace)).toEqual(['gone']);
        vm.dispose();
    });

    it('asks for a workspace trace only while the map shows the workspace', async () => {
        const { deps, services } = fixture();
        let scope: 'repo' | 'workspace' = 'workspace';
        deps.getScope = () => scope;
        deps.getWorkspaceMap = () => merged;
        vi.mocked(services.api.stream).mockResolvedValue({ trace: { ...workspaceTrace, steps: workspaceTrace.steps.slice(0, 3) } });
        const vm = new TraceViewModel(deps);
        vm.setOutput('flowchart', false);
        vm.setPrompt('Order');
        await vm.runTrace();
        expect(vi.mocked(services.api.stream).mock.calls[0][1]).toMatchObject({ scope: 'workspace' });
        expect(vm.selected?.steps.map((s) => s.id)).toEqual(['checkout', 'api:orders-route']);
        scope = 'repo';
        vm.setPrompt('Again');
        await vm.runTrace();
        expect(vi.mocked(services.api.stream).mock.calls[1][1]).not.toHaveProperty('scope');
        vm.dispose();
    });
});

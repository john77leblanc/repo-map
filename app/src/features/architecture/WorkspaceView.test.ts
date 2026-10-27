import { describe, expect, it, vi } from 'vitest';
import { runInAction } from 'mobx';
import { ArchitectureViewModel } from './ArchitectureViewModel';
import { fixture } from './testFixture';
import { WorkspaceModel, freshnessBadges } from '../../models/WorkspaceModel';
import { mergeMaps } from '../../../../lib/workspace-map.mjs';
import type { WorkspaceView } from '../../models/types';

function workspaceFixture() {
    const base = fixture();
    const api = {
        groups: [{ id: 'routes', col: 1, title: 'Routes', open: true }],
        nodes: [
            { id: 'route', group: 'routes', kind: 'service', title: 'Route', provides: ['http:GET /two'] },
            { id: 'db', group: 'routes', kind: 'topic', title: 'DB' },
        ],
        edges: [{ from: 'route', to: 'db', type: 'sync' }],
    };
    runInAction(() => {
        base.repo.map.nodes[0].consumes = ['http:GET /two'];
    });
    const map = mergeMaps(base.repo.map, [{ name: 'api', title: 'API', map: api }], { columns: 1, homeTitle: 'Test' });
    const view: WorkspaceView = {
        workspace: { links: [{ name: 'api', dir: '../api' }], seams: [] },
        repos: [
            { name: 'home', title: 'Test', source: 'home', readable: true },
            { name: 'api', title: 'API', source: 'dir', readable: true, dir: '../api' },
        ],
        map: map as WorkspaceView['map'],
    };
    const stored: Record<string, unknown> = {};
    base.services.storage.get = <T,>(key: string, fallback: T) => (key in stored ? (stored[key] as T) : fallback);
    base.services.storage.set = vi.fn((key: string, value: unknown) => {
        stored[key] = value;
    });
    const workspace = new WorkspaceModel(base.services);
    runInAction(() => {
        workspace.view = view;
    });
    const make = () => new ArchitectureViewModel({ repo: base.repo, services: base.services, workspace });
    return { ...base, workspace, view, stored, make, vm: make() };
}

describe('workspace view', () => {
    it('shows this repo until another repo is linked, then the merged map', () => {
        const { vm, workspace, view } = workspaceFixture();
        expect(vm.scope).toBe('repo');
        vm.setScope('workspace');
        expect(vm.map.nodes.map((n) => n.id)).toEqual(['one', 'two', 'api:route', 'api:db']);
        expect(vm.seamsFor('one').map((e) => e.to)).toEqual(['api:route']);
        expect(vm.nodeTitle('api:route')).toBe('Route (API)');
        expect(vm.repoTitle('home')).toBe('');
        runInAction(() => {
            workspace.view = { ...view, repos: [view.repos[0], { ...view.repos[1], error: 'gone' }] };
        });
        expect(vm.scope).toBe('repo');
        expect(vm.map.nodes).toHaveLength(2);
    });

    it('treats a link turned off as not linked', () => {
        const { vm, workspace, view } = workspaceFixture();
        runInAction(() => {
            workspace.view = { ...view, repos: [view.repos[0], { ...view.repos[1], off: true }] };
        });
        vm.setScope('workspace');
        expect(workspace.linked).toBe(false);
        expect(vm.scope).toBe('repo');
        expect(workspace.activeRepos.map((r) => r.name)).toEqual(['home']);
        expect(freshnessBadges(workspace.repos[1])).toEqual([expect.objectContaining({ text: 'off' })]);
    });

    it('setOff saves the choice and takes the server view', async () => {
        const { workspace, view, services } = workspaceFixture();
        const offView = { ...view, repos: [view.repos[0], { ...view.repos[1], off: true }] };
        const request = vi.fn(async () => offView);
        services.api.request = request as typeof services.api.request;
        expect(await workspace.setOff('api', true)).toBe(true);
        expect(request).toHaveBeenCalledWith('/api/workspace/off', { method: 'PUT', body: JSON.stringify({ name: 'api', off: true }) });
        expect(workspace.repos[1].off).toBe(true);
        expect(workspace.saving).toBe(false);
    });
    it('collapses a repo, remembers it, and expands it to open one of its cards', () => {
        const { vm, make, stored } = workspaceFixture();
        vm.setScope('workspace');
        vm.toggleRepo('api');
        expect(vm.isRepoCollapsed('api')).toBe(true);
        const card = vm.nodes.get('c:repo:api')!;
        expect(card.members).toEqual(['api:route', 'api:db']);
        expect(vm.map.edges.find((e) => e.seam)).toMatchObject({ from: 'one', to: 'c:repo:api' });
        expect(Object.values(stored)).toContainEqual(['repo:api']);
        const again = make();
        expect(again.scope).toBe('workspace');
        expect(again.nodes.has('c:repo:api')).toBe(true);
        vm.inspect('c:repo:api');
        vm.expandCollapsed('c:repo:api', 'api:db');
        expect(vm.isRepoCollapsed('api')).toBe(false);
        expect(vm.selected).toBe('api:db');
    });
    it('turns freshness into short badges', () => {
        const repo = { name: 'api', title: 'API', source: 'dir' as const, readable: true };
        expect(freshnessBadges({ ...repo, error: 'gone' })[0]).toMatchObject({ text: 'unavailable', tone: 'warn' });
        expect(freshnessBadges({ ...repo, freshness: { map: { state: 'current', commit: null, changed: 0, commitsSince: 0 }, remote: { state: 'current', branch: 'origin/main' } } })
            .map((b) => b.text)).toEqual(['current']);
        expect(freshnessBadges({ ...repo, freshness: { map: { state: 'stale', commit: 'a', changed: 3, commitsSince: 1 }, remote: { state: 'behind', branch: 'origin/trunk', behind: 4 } } })
            .map((b) => b.text)).toEqual(['map stale', 'behind trunk 4']);
        expect(freshnessBadges({ ...repo, source: 'snapshot', freshness: { snapshot: { state: 'old', exportedAt: null, commit: 'a' } } })[0].text).toBe('snapshot old');
    });
});

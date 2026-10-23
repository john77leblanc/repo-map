import { describe, expect, it } from 'vitest';
import { fixture } from './testFixture';

describe('ArchitectureViewModel', () => {
    it('restores the original group snapshot across trace switching without persisting trace changes', () => {
        const { vm, trace, services } = fixture();
        vm.setTrace(trace);
        expect(vm.isOpen('a')).toBe(false);
        expect(vm.isOpen('b')).toBe(true);
        vm.expand(true);
        vm.setTrace({ ...trace, steps: [{ id: 'one', note: '' }] });
        vm.setTrace(null);
        expect(vm.isOpen('a')).toBe(true);
        expect(vm.isOpen('b')).toBe(false);
        expect(services.storage.set).not.toHaveBeenCalled();
    });
    it('composes proposal changes without modifying repository data', () => {
        const { vm, repo, trace } = fixture();
        const original = JSON.stringify(repo.map);
        vm.setTrace({
            ...trace,
            proposal: {
                rationale: '',
                assumptions: [],
                questions: [],
                nodes: [
                    {
                        id: 'proposal:new',
                        title: 'New',
                        group: 'a',
                        kind: 'service',
                        status: 'new',
                    },
                ],
                edges: [],
            },
        });
        expect(vm.map.nodes).toHaveLength(3);
        expect(JSON.stringify(repo.map)).toBe(original);
        vm.setTrace(null);
        expect(vm.map.nodes).toHaveLength(2);
    });
    it('searches, reveals and filters focused connections', () => {
        const { vm } = fixture();
        vm.setQuery('TWO');
        expect(vm.isOpen('b')).toBe(true);
        vm.searchEnter();
        expect(vm.selected).toBe('two');
        expect(vm.relevant?.has('one')).toBe(true);
        vm.toggleType('http');
        expect(vm.relevant?.has('one')).toBe(false);
        vm.dismiss();
        expect(vm.relevant).toBe(null);
    });
    it('ignores navigation and trace updates after disposal', () => {
        const { vm, trace } = fixture();
        vm.dispose();
        vm.reveal('one');
        vm.setTrace(trace);
        vm.inspect('one');
        expect(vm.revealVersion).toBe(0);
        expect(vm.trace).toBe(null);
        expect(vm.selected).toBe(null);
    });
});

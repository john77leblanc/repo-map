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
    it('lists search results by column and group, all cards when the query is empty', () => {
        const { vm, repo } = fixture();
        repo.map.nodes[1].desc = 'Stores the shopping basket between visits';
        vm.openSearch();
        expect(vm.sideOpen).toBe(true);
        expect(vm.searchSections.map((c) => [c.title, c.groups.map((g) => g.title)])).toEqual([['Code', ['Alpha', 'Beta']]]);
        expect(vm.searchHits).toEqual(['one', 'two']);
        vm.setQuery('basket');
        expect(vm.searchHits).toEqual(['two']);
        expect(vm.searchSections[0].groups[0].nodes[0].snippet).toEqual({
            before: 'Stores the shopping ',
            hit: 'basket',
            after: ' between visits',
        });
        vm.setQuery('one');
        expect(vm.searchSections[0].groups[0].nodes[0].snippet).toBeUndefined();
        vm.setQuery('nothing');
        expect(vm.searchSections).toEqual([]);
    });
    it('moves through results, opens one, goes back and closes', () => {
        const { vm } = fixture();
        vm.openSearch();
        vm.moveCursor(-1);
        expect(vm.searchCursor).toBe(0);
        vm.moveCursor(5);
        expect(vm.searchCursor).toBe(1);
        vm.searchEnter();
        expect(vm.selected).toBe('two');
        expect(vm.searchOpen).toBe(true);
        vm.backToResults();
        expect(vm.selected).toBe(null);
        expect(vm.sideOpen).toBe(true);
        vm.setQuery('one');
        vm.inspect('one');
        vm.dismiss();
        expect(vm.sideOpen).toBe(false);
        expect(vm.query).toBe('');
    });
    it('one groups toggle expands all while any group is closed, then collapses all', () => {
        const { vm } = fixture();
        expect(vm.allOpen).toBe(false);
        vm.toggleGroups();
        expect(vm.allOpen).toBe(true);
        expect(vm.isOpen('b')).toBe(true);
        vm.toggleGroups();
        expect(vm.isOpen('a')).toBe(false);
        expect(vm.isOpen('b')).toBe(false);
        vm.setGroup('a', true);
        vm.toggleGroups();
        expect(vm.allOpen).toBe(true);
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

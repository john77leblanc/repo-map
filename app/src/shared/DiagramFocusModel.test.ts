import { describe, expect, it } from 'vitest';
import { observable } from 'mobx';
import { neighborhood } from './diagramFocus';
import { DiagramFocusModel } from './DiagramFocusModel';

const edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd' }];

describe('neighborhood', () => {
    it('adds the far end and index of every touching edge', () => {
        const result = neighborhood(edges, new Set(['b']));
        expect([...result.nodes].sort()).toEqual(['a', 'b', 'c']);
        expect(result.edges).toEqual([0, 1]);
    });
    it('keeps unconnected focus ids and returns nothing else', () => {
        const result = neighborhood(edges, new Set(['z']));
        expect([...result.nodes]).toEqual(['z']);
        expect(result.edges).toEqual([]);
    });
});

describe('DiagramFocusModel', () => {
    const setup = () => {
        const state = observable({ layout: { edges } as { edges: typeof edges } | null, selected: null as string | null, override: null as { nodes: string[]; edges: number[] } | null });
        const focus = new DiagramFocusModel({ layout: () => state.layout, selected: () => state.selected, override: () => state.override });
        return { state, focus };
    };
    it('prefers override, then hover, then the pinned selection', () => {
        const { state, focus } = setup();
        expect(focus.highlight).toBeNull();
        state.selected = 'd';
        expect(focus.highlight).toEqual({ nodes: ['d', 'c'], edges: [2] });
        focus.hover('a');
        expect(focus.highlight).toEqual({ nodes: ['a', 'b'], edges: [0] });
        state.override = { nodes: ['x'], edges: [] };
        expect(focus.highlight).toEqual({ nodes: ['x'], edges: [] });
        state.override = null;
        focus.hover(null);
        expect(focus.highlight?.nodes[0]).toBe('d');
    });
    it('hovers an edge as itself and its two ends, replacing node hover', () => {
        const { state, focus } = setup();
        state.selected = 'a';
        focus.hover('d');
        focus.hoverEdge(1);
        expect(focus.hoverId).toBeNull();
        expect(focus.highlight).toEqual({ nodes: ['b', 'c'], edges: [1] });
        focus.hover(null);
        expect(focus.hoverEdgeIndex).toBeNull();
        expect(focus.highlight?.nodes[0]).toBe('a');
        focus.hoverEdge(9);
        expect(focus.highlight?.nodes[0]).toBe('a');
    });
    it('clears hover on reset and returns null without a layout', () => {
        const { state, focus } = setup();
        focus.hover('b');
        focus.reset();
        expect(focus.hoverId).toBeNull();
        focus.hover('b');
        state.layout = null;
        expect(focus.highlight).toBeNull();
    });
});

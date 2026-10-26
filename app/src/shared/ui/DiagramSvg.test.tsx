import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { DiagramSvg } from './DiagramSvg';
import { fixture } from '../../features/flowchart/testFixture';

afterEach(cleanup);

describe('DiagramSvg selection', () => {
    it('marks steps with a tint and check badge, and plain clicks mark in select mode', () => {
        const { vm, trace } = fixture();
        vm.setTrace({ ...trace, flow: {
            nodes: [{ id: 'a', type: 'start', label: 'A' }, { id: 'b', type: 'decision', label: 'B?' }, { id: 'c', type: 'end', label: 'C' }],
            edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c', label: 'yes' }],
        } });
        const { container } = render(<DiagramSvg vm={vm} />);
        const node = (id: string) => container.querySelector(`[data-id="${id}"]`)!;
        fireEvent.click(node('a'), { shiftKey: true });
        expect(node('a').classList.contains('mk')).toBe(true);
        expect(node('a').querySelectorAll('.mk-badge')).toHaveLength(1);
        expect(node('a').getAttribute('aria-label')).toMatch(/, selected$/);
        expect(vm.selectedId).toBe(null);
        fireEvent.click(node('b'));
        expect(vm.selectedId).toBe('b');
        expect(node('b').classList.contains('mk')).toBe(false);
        vm.toggleSelecting();
        fireEvent.click(node('b'));
        expect(vm.marked).toEqual(['a', 'b']);
        expect(node('b').querySelectorAll('.mk-badge')).toHaveLength(1);
        fireEvent.click(node('a'));
        expect(vm.marked).toEqual(['b']);
        expect(node('a').querySelector('.mk-badge')).toBe(null);
        expect(node('a').getAttribute('aria-label')).not.toMatch(/selected/);
        vm.dispose();
    });
});

describe('DiagramSvg focus', () => {
    it('dims everything but a hovered node, its links, labels and neighbours; a pinned node stays focused', () => {
        const { vm, trace } = fixture();
        vm.setTrace({ ...trace, flow: {
            nodes: [{ id: 'a', type: 'start', label: 'A' }, { id: 'b', type: 'process', label: 'B' }, { id: 'c', type: 'end', label: 'C' }],
            edges: [{ from: 'a', to: 'b', label: 'go' }, { from: 'b', to: 'c', label: 'finish' }],
        } });
        const { container } = render(<DiagramSvg vm={vm} />);
        const svg = () => container.querySelector('svg')!;
        const node = (id: string) => container.querySelector(`[data-id="${id}"]`)!;
        fireEvent.mouseOver(node('a').querySelector('text')!);
        expect(svg().classList.contains('hovering')).toBe(true);
        expect(['a', 'b', 'c'].map((id) => node(id).classList.contains('hl'))).toEqual([true, true, false]);
        expect(['a', 'b', 'c'].map((id) => node(id).classList.contains('hl-main'))).toEqual([true, false, false]);
        // Each shape gets a ring and a gap copy beneath it for the main-highlight outline.
        expect([...node('a').children].slice(0, 3).map((child) => child.getAttribute('class'))).toEqual(['fs-ring', 'fs-gap', 'fs']);
        expect(container.querySelectorAll('.fe.hl')).toHaveLength(1);
        expect(container.querySelector('.fl.hl')?.textContent).toBe('go');
        // Captions paint after the boxes, and the highlighted one is last.
        const layers = [...svg().children].map((child) => child.getAttribute('class'));
        expect(layers.at(-1)).toBe('fl-all');
        expect(container.querySelector('.fl-all')!.lastElementChild?.textContent).toBe('go');
        fireEvent.mouseLeave(container.querySelector('#fl-svgbox')!);
        expect(svg().classList.contains('hovering')).toBe(false);
        fireEvent.click(node('c'));
        fireEvent.mouseLeave(container.querySelector('#fl-svgbox')!);
        expect(svg().classList.contains('hovering')).toBe(true);
        expect(node('b').classList.contains('hl')).toBe(true);
        expect(node('a').classList.contains('hl')).toBe(false);
        vm.dispose();
    });
    it('hovers a path or its caption to show it and its two ends; clicking it does nothing', () => {
        const { vm, trace } = fixture();
        vm.setTrace({ ...trace, flow: {
            nodes: [{ id: 'a', type: 'start', label: 'A' }, { id: 'b', type: 'process', label: 'B' }, { id: 'c', type: 'end', label: 'C' }],
            edges: [{ from: 'a', to: 'b', label: 'go' }, { from: 'b', to: 'c', label: 'finish' }],
        } });
        const { container } = render(<DiagramSvg vm={vm} />);
        const svg = () => container.querySelector('svg')!;
        const node = (id: string) => container.querySelector(`[data-id="${id}"]`)!;
        const hit = container.querySelector('.fe-hit[data-i="1"]')!;
        expect(container.querySelectorAll('.fe-hit')).toHaveLength(2);
        fireEvent.mouseOver(hit);
        expect(svg().classList.contains('hovering')).toBe(true);
        expect(['a', 'b', 'c'].map((id) => node(id).classList.contains('hl'))).toEqual([false, true, true]);
        expect([...container.querySelectorAll('.fe.hl')].map((e) => (e as SVGElement).dataset.i)).toEqual(['1']);
        fireEvent.mouseOver(container.querySelector('.fl[data-i="0"]')!);
        expect(['a', 'b', 'c'].map((id) => node(id).classList.contains('hl'))).toEqual([true, true, false]);
        fireEvent.click(node('a'));
        fireEvent.click(hit);
        expect(vm.selectedId).toBe('a');
        fireEvent.mouseLeave(container.querySelector('#fl-svgbox')!);
        expect(node('c').classList.contains('hl')).toBe(false);
        vm.dispose();
    });
});

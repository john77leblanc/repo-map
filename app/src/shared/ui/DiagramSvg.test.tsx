import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { DiagramSvg } from './DiagramSvg';
import { fixture } from '../../features/flowchart/testFixture';

afterEach(cleanup);

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

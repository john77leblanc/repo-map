import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { FlowchartWorkspace } from './FlowchartWorkspace';
import { CodeReference } from '../../shared/ui/CodeReference';
import { ConnectionRow } from './ConnectionRow';
import { fixture } from './testFixture';
import type { CodeRef } from '../../models/types';

const Reference = ({ reference }: { reference: CodeRef }) => <span>{reference.path}</span>;
describe('FlowchartWorkspace', () => {
    it('lists selected steps in the side panel, collapses them there, and renames the group as you type', () => {
        const { vm, trace } = fixture();
        vm.setTrace({ ...trace, flow: {
            nodes: [{ id: 'a', type: 'start', label: 'Open' }, { id: 'b', type: 'process', label: 'Save' }, { id: 'c', type: 'end', label: 'Done' }],
            edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }],
        } });
        const { container, unmount } = render(<FlowchartWorkspace vm={vm} CodeReference={Reference} />);
        expect(container.querySelector('.fmain.details-closed')).toBeTruthy();
        act(() => vm.mark('a'));
        const side = () => container.querySelector('#fl-side')!;
        expect(side().getAttribute('aria-label')).toBe('Selected steps');
        expect(container.querySelector('.fmain.details-closed')).toBe(null);
        expect(screen.getByRole('heading', { name: '1 step selected' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Collapse' })).toBeDisabled();
        act(() => vm.mark('b'));
        expect([...side().querySelectorAll('[data-marked]')].map((li) => li.getAttribute('data-marked'))).toEqual(['a', 'b']);
        fireEvent.click(screen.getByRole('button', { name: 'Remove Open' }));
        expect(vm.marked).toEqual(['b']);
        act(() => vm.mark('c'));
        fireEvent.click(screen.getByRole('button', { name: 'Collapse' }));
        expect(vm.selected?.collapsed).toBe(true);
        const name = screen.getByRole('textbox', { name: 'Group name' }) as HTMLInputElement;
        expect(name.value).toBe('');
        expect(name.placeholder).toBe('Save (+1 more)');
        fireEvent.change(name, { target: { value: 'Finish' } });
        expect(vm.selected?.label).toBe('Finish');
        expect(container.querySelector('label.ft')).toBe(null);
        fireEvent.click(screen.getByRole('button', { name: 'Select steps' }));
        expect(vm.selecting).toBe(true);
        unmount();
        vm.dispose();
    });
    it('offers a closer look for a box, then shows it with Expand / Collapse in chart and a clickable mini drawing', async () => {
        const { vm, trace, services } = fixture();
        Object.defineProperty(vm.repo, 'aiAvailable', { get: () => true });
        vi.mocked(services.api.stream).mockResolvedValueOnce({ expansion: {
            summary: 'Checks the cart.', gaps: '',
            nodes: [{ id: 'x1', type: 'process', label: 'Load the cart' }, { id: 'x2', type: 'decision', label: 'Signed in?' }],
            edges: [{ from: 'x1', to: 'x2' }], entry: 'x1', exits: [{ arrow: 1, from: 'x2' }],
        } });
        vm.setTrace(trace);
        const { container, unmount } = render(<FlowchartWorkspace vm={vm} CodeReference={Reference} />);
        act(() => vm.select('b'));
        expect(screen.queryByRole('button', { name: 'Look closer' })).toBeTruthy();
        act(() => vm.select('a'));
        await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Look closer' })));
        // drawn in place: the panel follows the closer look's first step
        expect(vm.selectedId).toBe('a.1');
        expect(screen.queryByText(/^Inside:/)).toBe(null);
        expect(container.querySelector('#fl-side .disclosure-list.in-closer')).toBeTruthy();
        expect(container.querySelector('#fl-closer.has-look')).toBeTruthy();
        expect(screen.getByText('Checks the cart.')).toBeTruthy();
        expect(container.querySelector('#fl-closer h4')?.textContent?.replace(/\s+/g, ' ')).toBe('Closer look inside Ready?');
        expect(container.querySelector('#fl-closer .flow-closer-box')?.getAttribute('title')).toBe('Ready?');
        expect(container.querySelector('#fl-closer h4 .fshape')).toBe(null);
        expect(container.querySelector('#fl-side .fside-head h3 .fshape .xp')).toBeTruthy();
        expect(container.querySelector('#fl-closer .flow-closer-count')?.textContent).toBe('(2 steps)');
        // the mini drawing shows while drawn in the chart, outlines the selected step and selects on click
        expect(container.querySelector('.flow-mini .fn.sel')?.getAttribute('data-id')).toBe('a.1');
        fireEvent.click(container.querySelector('.flow-mini .fn[data-id="a.2"] text')!);
        expect(vm.selectedId).toBe('a.2');
        expect(container.querySelector('.flow-mini .fn.sel')?.getAttribute('data-id')).toBe('a.2');
        expect(container.querySelector('#fl-closer ol')).toBe(null);
        expect(container.querySelector('.fc .xp-frame')).toBeTruthy();
        expect(container.querySelector('.fc .xp-title')?.textContent).toContain('Expanded: Ready?');
        expect(container.querySelectorAll('.fc .fn.xp')).toHaveLength(2);
        fireEvent.click(screen.getByRole('button', { name: 'Collapse in chart' }));
        expect(vm.selectedId).toBe('a');
        expect(container.querySelector('#fl-closer h4')?.textContent).toBe('Closer look');
        expect(container.querySelector('.fc .xp-badge')).toBeTruthy();
        expect(container.querySelector('.flow-mini svg')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Expand in chart' })).toBeTruthy();
        // clicking a step in the folded mini drawing draws the closer look and selects it
        fireEvent.click(container.querySelector('.flow-mini .fn[data-id="a.2"]')!);
        expect(vm.isShown('a')).toBe(true);
        expect(vm.selectedId).toBe('a.2');
        unmount();
        vm.dispose();
    });
    it('puts Closer look below the sections, with its progress and Stop beside the button, not in the toolbar', async () => {
        const { vm, trace, services } = fixture();
        Object.defineProperty(vm.repo, 'aiAvailable', { get: () => true });
        let progress: (text: string) => void = () => {};
        vi.mocked(services.api.stream).mockImplementationOnce((_path, _body, signal, onProgress) => {
            progress = onProgress as (text: string) => void;
            return new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted'))));
        });
        vm.setTrace(trace);
        const { container, unmount } = render(<FlowchartWorkspace vm={vm} CodeReference={Reference} />);
        act(() => vm.select('a'));
        const closer = container.querySelector('#fl-side > section#fl-closer')!;
        expect(closer).toBeTruthy();
        expect(closer.previousElementSibling?.className).toBe('fside-rule');
        expect(container.querySelector('.disclosure[data-section="fl-closer"]')).toBe(null);
        await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Look closer' })));
        act(() => progress('Reading the cart'));
        expect(container.querySelector('#fl-closer-status')?.textContent).toMatch(/^Reading the cart/);
        expect(container.querySelector('#fl-status')?.textContent).toBe('');
        expect(container.querySelector('#fl-stop')?.hasAttribute('hidden')).toBe(true);
        await act(async () => fireEvent.click(container.querySelector('#fl-closer-stop')!));
        expect(container.querySelector('#fl-closer-status')?.textContent).toBe('Stopped.');
        expect(container.querySelector('#fl-status')?.textContent).toBe('');
        unmount();
        vm.dispose();
    });
    it('renders all legend symbols and shows change labels only for proposals', () => {
        const { vm, trace } = fixture();
        vm.setTrace(trace);
        const { container, rerender, unmount } = render(
            <FlowchartWorkspace vm={vm} CodeReference={Reference} />
        );
        const legend = container.querySelector('#flowchart-key')!;
        expect(legend.querySelectorAll('svg')).toHaveLength(9);
        expect(legend.hasAttribute('hidden')).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'Diagram key' }));
        expect(legend.hasAttribute('hidden')).toBe(false);
        expect(legend.querySelector('[data-proposal-key]')?.hasAttribute('hidden')).toBe(true);
        vm.setTrace({ ...trace, intent: 'proposal' });
        rerender(<FlowchartWorkspace vm={vm} CodeReference={Reference} />);
        expect(legend.querySelector('[data-proposal-key]')?.hasAttribute('hidden')).toBe(false);
        unmount();
        vm.dispose();
    });
    it('opens the right panel only on selection, with doc labels and From/To connections', () => {
        const { vm, trace } = fixture();
        vm.setTrace(trace);
        vm.repo.docs.checkout[0].title = 'Checkout guide';
        const { container, unmount } = render(
            <FlowchartWorkspace vm={vm} CodeReference={CodeReference} />
        );
        expect(container.querySelector('#fl-side')).toBeNull();
        expect(container.querySelector('.fmain.details-closed')).toBeTruthy();
        act(() => vm.select('a'));
        const side = container.querySelector('.fmain #fl-side')!;
        expect(side).toBeTruthy();
        expect(container.querySelector('.fmain.details-closed')).toBeNull();
        expect(side.querySelector('h3')?.textContent).toBe('Ready?');
        expect(side.querySelector('.fside-kind .ft')?.textContent).toBe('Step — Decision');
        expect([...side.querySelectorAll('.disclosure-head')].every((h) => h.getAttribute('aria-expanded') === 'false')).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: /^References/ }));
        expect(screen.getByText('Checkout guide')).toBeTruthy();
        expect(screen.getByText('Agent guide')).toBeTruthy();
        expect(screen.getByText('README.md#L3-L4')).toBeTruthy();
        expect(side.querySelector('.flow-conn')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /^Connections/ }));
        expect(vm.sections.connections).toBe(true);
        expect(screen.getByRole('tab', { name: /To/ }).getAttribute('aria-selected')).toBe('true');
        expect(side.querySelector('.flow-conn li')?.textContent).toBe('yesDone');
        fireEvent.mouseEnter(side.querySelector('[data-go="b"]')!);
        expect([...container.querySelectorAll('.fn.hl-main')].map((n) => (n as SVGElement).dataset.id)).toEqual(['b']);
        expect(container.querySelector('.fn[data-id="a"]')?.classList.contains('hl')).toBe(true);
        fireEvent.click(side.querySelector('[data-go="b"]')!);
        expect(vm.selectedId).toBe('b');
        fireEvent.click(screen.getByRole('button', { name: 'About' }));
        expect(screen.getByText(/Inferred\. Check this step/)).toBeTruthy();
        expect(side.querySelector('[data-go="a"]')).toBeTruthy();
        fireEvent.keyDown(side, { key: 'Escape' });
        expect(vm.selectedId).toBeNull();
        expect(container.querySelector('#fl-side')).toBeNull();
        expect(document.activeElement).toBe(container.querySelector('.fn[data-id="b"]'));
        act(() => vm.select('a'));
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
        expect(vm.selectedId).toBeNull();
        unmount();
        vm.dispose();
    });
    it('shows a connection change status as a coloured badge inside its button', () => {
        const { vm, trace, flow } = fixture();
        vm.setTrace({ ...trace, intent: 'proposal', flow: {
            nodes: [{ ...flow.nodes[0], status: 'modified' }, flow.nodes[1]],
            edges: [{ ...flow.edges[0], status: 'new' }],
        } });
        act(() => vm.select('a'));
        vm.setSection('connections', true);
        vm.setSection('about', true);
        const { container, unmount } = render(<FlowchartWorkspace vm={vm} CodeReference={Reference} />);
        expect(container.querySelector('#fl-side .flow-change h4.modified')?.textContent).toBe('Modified');
        expect(container.querySelector('#fl-side .fside-kind .proposal-badge.modified')?.textContent).toBe('Modified');
        // rows look like architecture's: target's shape, its name, then the arrow label
        const row = container.querySelector('#fl-side .flow-conn button.cl[data-go="b"]')!;
        expect(row.querySelector('svg.fshape .lg.se')).toBeTruthy();
        expect(row.querySelector('b')?.textContent).toBe('Done');
        // the chip is the connected step's status (Done is unchanged), and the arrow carries the arrow's
        expect(row.querySelector('.proposal-badge')).toBe(null);
        const arrow = row.querySelector('.fl-arrow')!;
        expect(arrow.textContent).toBe('yes');
        expect(arrow).toHaveClass('change-new');
        // a To row reads arrow first, then the target; a From row starts with the shape
        expect(row).toHaveClass('to');
        expect(row.firstElementChild).toHaveClass('cl-arrow');
        expect(row.firstElementChild?.nextElementSibling).toHaveClass('fshape');
        expect(row.querySelector('em')).toBe(null);
        // from Done's side, the connected step is the modified one: chip before its title
        act(() => vm.select('b'));
        act(() => vm.setConnectionTab('from'));
        const back = container.querySelector('#fl-side .flow-conn button.cl[data-go="a"]')!;
        expect(back.querySelector('.cl-title .proposal-badge.modified + b')?.textContent).toBe('Ready?');
        expect(back).not.toHaveClass('to');
        // same parts as a To row, with the arrow below the name
        expect([...back.children].map((c) => c.getAttribute('class'))).toEqual(['fshape', 'cl-text', 'cl-arrow']);
        expect([...row.children].map((c) => c.getAttribute('class'))).toEqual(['cl-arrow', 'fshape', 'cl-text']);
        expect(back.querySelector('.cl-arrow .fl-arrow-head')).toBeTruthy();
        expect(row.querySelector('.cl-arrow .fl-arrow-head')).toBeTruthy();
        unmount();
        vm.dispose();
    });
    it('selects SVG nodes with keyboard and shows refs/docs without architecture badges', () => {
        const { vm, trace } = fixture();
        vm.setTrace(trace);
        const { container, unmount } = render(
            <FlowchartWorkspace vm={vm} CodeReference={Reference} />
        );
        const node = container.querySelector('.fn[data-id="a"]')!;
        fireEvent.keyDown(node, { key: 'Enter' });
        fireEvent.click(screen.getByRole('button', { name: /^References/ }));
        expect(screen.getByText('main.ts')).toBeTruthy();
        expect(screen.getByText('README.md')).toBeTruthy();
        expect(container.querySelector('.fn.sel')).toBe(node);
        expect(container.querySelector('.proposal-badge')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Diagram key' }));
        expect(
            screen.getByRole('button', { name: 'Diagram key' }).getAttribute('aria-expanded')
        ).toBe('true');
        fireEvent.click(node);
        expect(vm.selectedId).toBeNull();
        unmount();
        vm.dispose();
    });
    it('offers retry for a missing diagram and disables exports', () => {
        const { vm, trace } = fixture();
        vm.setTrace({ ...trace, flow: null, pendingFlow: true });
        const { unmount } = render(<FlowchartWorkspace vm={vm} CodeReference={Reference} />);
        expect(
            (screen.getByRole('button', { name: 'Export' }) as HTMLButtonElement).disabled
        ).toBe(true);
        expect(screen.getByText(/supporting walkthrough was kept/).id).toBe('flow-missing');
        unmount();
        vm.dispose();
    });
});
describe('ConnectionRow', () => {
    it('leaves the arrow out of a To or From row without a label', () => {
        const props = { go: 'x', title: 'Next', shape: { type: 'process' }, arrow: {}, onClick: () => {}, onHover: () => {} };
        const { container, rerender } = render(<ConnectionRow {...props} direction="to" />);
        expect(container.querySelector('.cl.to .cl-arrow')).toBe(null);
        expect(container.querySelector('.cl.to')?.firstElementChild).toHaveClass('fshape');
        expect(container.querySelector('.fl-arrow')).toBe(null);
        rerender(<ConnectionRow {...props} />);
        expect(container.querySelector('.fl-arrow')).toBe(null);
    });
});

import { describe, it, expect } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { FlowchartWorkspace } from './FlowchartWorkspace';
import { CodeReference } from '../../shared/ui/CodeReference';
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
    it('renders all legend symbols and shows change labels only for proposals', () => {
        const { vm, trace } = fixture();
        vm.setTrace(trace);
        const { container, rerender, unmount } = render(
            <FlowchartWorkspace vm={vm} CodeReference={Reference} />
        );
        const legend = container.querySelector('#flowchart-key')!;
        expect(legend.querySelectorAll('svg')).toHaveLength(7);
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
        expect(screen.getByText('Checkout guide')).toBeTruthy();
        expect(screen.getByText('Agent guide')).toBeTruthy();
        expect(screen.getByText('README.md#L3-L4')).toBeTruthy();
        expect(screen.getByRole('tab', { name: /To/ }).getAttribute('aria-selected')).toBe('true');
        expect(side.querySelector('.flow-conn li')?.textContent).toBe('Doneyes');
        fireEvent.mouseEnter(side.querySelector('[data-go="b"]')!);
        expect([...container.querySelectorAll('.fn.hl-main')].map((n) => (n as SVGElement).dataset.id)).toEqual(['b']);
        expect(container.querySelector('.fn[data-id="a"]')?.classList.contains('hl')).toBe(true);
        fireEvent.click(side.querySelector('[data-go="b"]')!);
        expect(vm.selectedId).toBe('b');
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
        const { container, unmount } = render(<FlowchartWorkspace vm={vm} CodeReference={Reference} />);
        const badge = container.querySelector('#fl-side [data-go="b"] .proposal-badge.new');
        expect(badge?.textContent).toBe('New');
        expect(container.querySelector('#fl-side .flow-change h4.modified')?.textContent).toBe('Modified');
        expect(container.querySelector('#fl-side .flow-conn li .hint')?.textContent).toBe('yes');
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

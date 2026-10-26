import { fireEvent, render, screen, cleanup, act } from '@testing-library/react';
import { runInAction } from 'mobx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArchitectureWorkspace } from './ArchitectureWorkspace';
import { fixture } from './testFixture';

afterEach(cleanup);
describe('ArchitectureWorkspace', () => {
    it.each(['node', 'group'])('clears %s hover in empty diagram space', (item) => {
        const { vm } = fixture();
        const { container } = render(<ArchitectureWorkspace vm={vm} />);
        const target = item === 'node'
            ? screen.getByRole('button', { name: 'One' })
            : container.querySelector('summary')!;
        const space = container.querySelector('.colh')!;
        fireEvent.mouseOver(target);
        expect(vm.hover).toBe(item === 'node' ? 'one' : 'g:a');
        expect(vm.active?.has('one')).toBe(true);
        fireEvent.mouseOut(target, { relatedTarget: space });
        expect(vm.hover).toBe(null);
        expect(vm.active).toBe(null);
        expect(container.querySelector('.node.act')).toBe(null);
    });
    it('switches hover directly between items without clearing on child transitions', () => {
        const { vm } = fixture();
        const { container } = render(<ArchitectureWorkspace vm={vm} />);
        const node = screen.getByRole('button', { name: 'One' });
        const header = container.querySelector('summary')!;
        fireEvent.mouseOver(node);
        const dot = node.querySelector('.dot')!;
        const name = node.querySelector('.nm')!;
        fireEvent.mouseOut(dot, { relatedTarget: name });
        fireEvent.mouseOver(name, { relatedTarget: dot });
        expect(vm.hover).toBe('one');
        fireEvent.mouseOut(node, { relatedTarget: header });
        expect(vm.hover).toBe('g:a');
        fireEvent.mouseOut(header, { relatedTarget: node });
        expect(vm.hover).toBe('one');
    });
    it('preserves keyboard focus and blur highlighting', () => {
        const { vm } = fixture();
        render(<ArchitectureWorkspace vm={vm} />);
        const node = screen.getByRole('button', { name: 'One' });
        fireEvent.focus(node);
        expect(vm.hover).toBe('one');
        fireEvent.blur(node);
        expect(vm.hover).toBe(null);
        expect(vm.active).toBe(null);
    });
    it('restores pinned selection highlighting after hover exits', () => {
        const { vm } = fixture();
        vm.inspect('two');
        const { container } = render(<ArchitectureWorkspace vm={vm} />);
        const node = screen.getByRole('button', { name: 'One' });
        fireEvent.mouseOver(node);
        expect(vm.active?.has('one')).toBe(true);
        fireEvent.mouseOut(node, { relatedTarget: container.querySelector('.colh')! });
        expect(vm.hover).toBe(null);
        expect(vm.selected).toBe('two');
        expect([...vm.active!]).toEqual(['two']);
    });
    it('restores trace highlighting after hover exits', () => {
        const { vm, trace } = fixture();
        vm.setTrace(trace);
        const { container } = render(<ArchitectureWorkspace vm={vm} />);
        const header = container.querySelector('summary')!;
        fireEvent.mouseOver(header);
        expect(vm.active?.has('one')).toBe(true);
        fireEvent.mouseOut(header, { relatedTarget: container.querySelector('.colh')! });
        expect(vm.hover).toBe(null);
        expect(vm.active).toBe(null);
        expect([...vm.relevant!]).toEqual(['two']);
    });
    it('opens a side panel only on selection and navigates connections', () => {
        const { vm } = fixture();
        const { container } = render(<ArchitectureWorkspace vm={vm} />);
        expect(container.querySelector('#arch-details')).toBe(null);
        expect(container.querySelector('.arch-stage.details-open')).toBe(null);
        fireEvent.click(screen.getByRole('button', { name: 'One' }));
        const panel = container.querySelector('.arch-stage.details-open > aside#arch-details')!;
        expect(panel).toBeTruthy();
        expect(container.querySelector('dialog, .arch-details-shade')).toBe(null);
        // Hovering a connection makes its card the main (filled) highlight.
        const two = screen.getByRole('button', { name: /Two\s*HTTP/ });
        fireEvent.mouseEnter(two);
        expect(vm.hover).toBe('two');
        expect(container.querySelector('.node.act')?.getAttribute('data-id')).toBe('two');
        fireEvent.mouseLeave(two);
        expect(vm.hover).toBe(null);
        expect(screen.getByRole('heading', { name: 'One' })).toBeTruthy();
        // One only sends: From is empty, so To is shown
        expect(screen.getByRole('tab', { name: 'From (0)' })).toBeDisabled();
        expect(screen.getByRole('tab', { name: 'To (1)' })).toHaveAttribute('aria-selected', 'true');
        fireEvent.click(screen.getByRole('button', { name: /Two\s*HTTP/ }));
        expect(vm.selected).toBe('two');
        expect(screen.getByRole('tab', { name: 'From (1)' })).toHaveAttribute('aria-selected', 'true');
        expect(vm.connectionsFor('two').from.map((c) => c.other)).toEqual(['one']);
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
        expect(vm.selected).toBe(null);
        expect(container.querySelector('#arch-details')).toBe(null);
        fireEvent.click(screen.getByRole('button', { name: 'One' }));
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(vm.selected).toBe(null);
    });
    it.each([['new', 'New'], ['modified', 'Modified']] as const)('shows a %s proposal badge beside the details title', (status, label) => {
        const { vm } = fixture();
        runInAction(() => { vm.repo.map.nodes.find((n) => n.id === 'one')!.status = status; });
        render(<ArchitectureWorkspace vm={vm} />);
        act(() => vm.inspect('one'));
        const title = screen.getByRole('heading', { name: 'One ' + label });
        expect(title.querySelector('.proposal-badge')).toHaveClass(status);
    });
    it('exposes search, connection filters and diagram key accessibly', () => {
        const { vm } = fixture();
        render(<ArchitectureWorkspace vm={vm} />);
        fireEvent.click(screen.getByRole('button', { name: 'Diagram key' }));
        fireEvent.click(screen.getByRole('button', { name: 'HTTP call' }));
        expect(vm.hidden.http).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: /Search/ }));
        const search = screen.getByRole('combobox', { name: 'Find a node' });
        fireEvent.change(search, { target: { value: 'two' } });
        fireEvent.keyDown(search, { key: 'Enter' });
        expect(vm.selected).toBe('two');
        expect(screen.getByRole('heading', { name: 'Two' })).toBeTruthy();
    });
    it('puts the search button last and lists results in the side panel', () => {
        const { vm } = fixture();
        const { container } = render(<ArchitectureWorkspace vm={vm} />);
        const controls = [...container.querySelectorAll('.controls > *')];
        expect(controls.at(-1)?.id).toBe('arch-search-toggle');
        fireEvent.click(screen.getByRole('button', { name: /Search/ }));
        expect(container.querySelector('.arch-stage.details-open > aside#arch-details')).toBeTruthy();
        const results = screen.getByRole('listbox', { name: 'Matching nodes' });
        expect([...results.querySelectorAll('[role=option]')].map((o) => o.textContent)).toEqual(['One', 'Two']);
        const search = screen.getByRole('combobox', { name: 'Find a node' });
        fireEvent.keyDown(search, { key: 'ArrowDown' });
        expect(screen.getByRole('option', { name: 'Two' })).toHaveAttribute('aria-selected', 'true');
        fireEvent.click(screen.getByRole('option', { name: 'One' }));
        expect(screen.getByRole('heading', { name: 'One' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: '← Results' }));
        expect(screen.getByRole('listbox', { name: 'Matching nodes' })).toBeTruthy();
        // Escape on a picked card goes back to results; on results it closes the panel
        fireEvent.click(screen.getByRole('option', { name: 'Two' }));
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(vm.searchOpen).toBe(true);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(container.querySelector('#arch-details')).toBe(null);
    });
    it('opens search with "/" and Ctrl+K, but not while typing', () => {
        const { vm } = fixture();
        render(<ArchitectureWorkspace vm={vm} />);
        const input = document.body.appendChild(document.createElement('input'));
        fireEvent.keyDown(input, { key: '/' });
        expect(vm.searchOpen).toBe(false);
        input.remove();
        fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
        expect(vm.searchOpen).toBe(true);
        act(() => vm.dismiss());
        fireEvent.keyDown(document, { key: '/' });
        expect(vm.searchOpen).toBe(true);
    });
    it('lists card contracts in its details panel', () => {
        const { vm } = fixture();
        runInAction(() => {
            Object.assign(vm.deps.repo.map!.nodes[0], { provides: ['http:GET /one/{}'], consumes: ['http:ANY /two', 'env:TWO_URL'] });
        });
        const { container } = render(<ArchitectureWorkspace vm={vm} />);
        fireEvent.click(screen.getByRole('button', { name: 'One' }));
        expect(container.querySelector('[data-contracts=provides]')?.textContent).toBe('Serves to other reposGET /one/{}');
        expect([...container.querySelectorAll('[data-contracts=consumes] li')].map((li) => li.textContent)).toEqual(['/two', 'env TWO_URL']);
    });
});

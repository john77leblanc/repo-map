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
        const search = screen.getByRole('searchbox');
        fireEvent.change(search, { target: { value: 'two' } });
        fireEvent.keyDown(search, { key: 'Enter' });
        expect(vm.selected).toBe('two');
        expect(screen.getByRole('heading', { name: 'Two' })).toBeTruthy();
    });
});

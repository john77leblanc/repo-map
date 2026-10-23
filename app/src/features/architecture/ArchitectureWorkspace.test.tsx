import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArchitectureWorkspace } from './ArchitectureWorkspace';
import { fixture } from './testFixture';

beforeEach(() => {
    Object.defineProperty(HTMLDialogElement.prototype, 'show', {
        configurable: true,
        value: function (this: HTMLDialogElement) {
            this.open = true;
        },
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
        configurable: true,
        value: function (this: HTMLDialogElement) {
            this.open = false;
        },
    });
});
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
    it('opens the scoped inspector and navigates connections', () => {
        const { vm } = fixture();
        render(<ArchitectureWorkspace vm={vm} />);
        fireEvent.click(screen.getByRole('button', { name: 'One' }));
        expect(screen.getByRole('heading', { name: 'One' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /Two\s*HTTP/ }));
        expect(vm.selected).toBe('two');
        fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
        expect(vm.selected).toBe(null);
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

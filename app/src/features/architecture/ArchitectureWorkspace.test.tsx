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

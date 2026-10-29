import { expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ComboboxModel } from '../../models/ComboboxModel';
import { Combobox } from './Combobox';

const options = [
    { value: 'main', label: 'main', group: 'Branches', meta: '2d' },
    { value: 'feature/coupons', label: 'feature/coupons', group: 'Branches', meta: '1d · 4 ahead' },
    { value: 'origin/old', label: 'origin/old', group: 'Remote branches', muted: true },
    { value: 'v1.0.0', label: 'v1.0.0', group: 'Tags' },
];

it('filters by typed text, groups options, moves with the keys and keeps free text', () => {
    const changed = vi.fn();
    const model = new ComboboxModel('', changed);
    model.setOptions(options);
    expect(model.groups.map((g) => g.group)).toEqual(['Branches', 'Remote branches', 'Tags']);
    model.type('COU');
    expect(model.filtered.map((o) => o.value)).toEqual(['feature/coupons']);
    model.move(1);
    expect(model.activeOption?.value).toBe('feature/coupons');
    expect(model.choose()).toBe(true);
    expect(model.value).toBe('feature/coupons');
    expect(model.open).toBe(false);
    expect(changed).toHaveBeenLastCalledWith('feature/coupons');
    // after choosing, the whole list shows again
    model.toggle();
    expect(model.filtered).toHaveLength(4);
    model.move(-1);
    expect(model.activeOption?.value).toBe('v1.0.0');
    model.type('HEAD~3');
    expect(model.filtered).toEqual([]);
    expect(model.choose()).toBe(false);
    expect(model.value).toBe('HEAD~3');
});

it('is an accessible combobox: arrows, Enter chooses without submitting, Escape closes without closing the dialog', () => {
    const model = new ComboboxModel('');
    model.setOptions(options);
    const submit = vi.fn((e: { preventDefault(): void }) => e.preventDefault());
    const cancel = vi.fn();
    render(<div onKeyDown={(e) => { if (e.key === 'Escape') cancel(); }}><form onSubmit={submit}>
        <label htmlFor="pick">Branch</label>
        <Combobox model={model} id="pick" toggleLabel="Show branches" />
    </form></div>);
    const input = screen.getByRole('combobox', { name: 'Branch' });
    expect(input).toHaveAttribute('aria-expanded', 'false');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listbox')).toBeVisible();
    expect(screen.getByRole('group', { name: 'Tags' })).toBeVisible();
    expect(input).toHaveAttribute('aria-activedescendant', 'pick-opt-0');
    expect(screen.getByRole('option', { name: /main/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: /origin\/old/ })).toHaveClass('muted');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(model.value).toBe('feature/coupons');
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Show branches' }));
    expect(model.open).toBe(true);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(model.open).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
    act(() => model.show());
    fireEvent.mouseDown(screen.getByRole('option', { name: /v1\.0\.0/ }));
    expect(model.value).toBe('v1.0.0');
});

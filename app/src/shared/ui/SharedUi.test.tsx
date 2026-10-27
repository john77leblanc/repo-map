import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { ProgressLog } from '../../models/ProgressLog';
import { ProgressLine } from './ProgressLine';
import { DirectionTabs, shownTab } from './DirectionTabs';
import { ModalHeader } from './ModalHeader';
import { Disclosure, DisclosureList } from './Disclosure';

describe('ProgressLog', () => {
    it('records entries with elapsed time, skipping repeats', () => {
        let now = 1000;
        const log = new ProgressLog(() => now);
        log.start('Starting…');
        now = 4000;
        log.push('Reading files');
        log.push('Reading files');
        now = 13600;
        log.push('Writing map');
        expect(log.entries).toEqual([
            { text: 'Starting…', at: 0 },
            { text: 'Reading files', at: 3000 },
            { text: 'Writing map', at: 12600 },
        ]);
        expect(log.last).toBe('Writing map');
        log.start();
        expect(log.entries).toEqual([]);
    });
});

describe('ProgressLine', () => {
    it('shows one line, and the history with elapsed seconds on demand', () => {
        const { container } = render(<ProgressLine busy entries={[{ text: 'Starting…', at: 0 }, { text: 'Reading a very long file name', at: 12400 }]} />);
        expect(screen.getByRole('status')).toHaveTextContent('Reading a very long file name');
        expect(screen.getByRole('status')).toHaveAttribute('title', 'Reading a very long file name');
        const details = container.querySelector('details')!;
        expect(details.open).toBe(false);
        fireEvent.click(container.querySelector('summary')!);
        const items = screen.getAllByRole('listitem').map((li) => li.textContent);
        expect(items).toEqual(['+0sStarting…', '+12sReading a very long file name']);
    });

    it('is plain text with a single entry', () => {
        const { container } = render(<ProgressLine text="Stopped." entries={[{ text: 'Starting…', at: 0 }]} />);
        expect(container.querySelector('details')).toBeNull();
        expect(screen.getByRole('status')).toHaveTextContent('Stopped.');
    });
});

describe('DirectionTabs', () => {
    function Harness({ from, to }: { from: number; to: number }) {
        const [active, setActive] = useState<'from' | 'to'>('from');
        return (
            <DirectionTabs idPrefix="t" label="Direction" active={active} onChange={setActive}
                tabs={[{ id: 'from', label: 'From', count: from }, { id: 'to', label: 'To', count: to }]}>
                {(tab) => <p>panel {tab}</p>}
            </DirectionTabs>
        );
    }

    it('falls back to the tab with items', () => {
        expect(shownTab([{ id: 'from', label: '', count: 0 }, { id: 'to', label: '', count: 2 }], 'from')).toBe('to');
        render(<Harness from={0} to={2} />);
        expect(screen.getByRole('tab', { name: 'From (0)' })).toBeDisabled();
        expect(screen.getByRole('tabpanel')).toHaveTextContent('panel to');
    });

    it('switches with arrow keys', () => {
        render(<Harness from={1} to={2} />);
        const from = screen.getByRole('tab', { name: 'From (1)' });
        expect(from).toHaveAttribute('tabindex', '0');
        fireEvent.keyDown(from, { key: 'ArrowRight' });
        expect(screen.getByRole('tab', { name: 'To (2)' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tabpanel')).toHaveTextContent('panel to');
    });
});

describe('ModalHeader', () => {
    it('puts the title and Close in one row', () => {
        const onClose = vi.fn();
        const { container } = render(<ModalHeader titleId="x-title" title="Things" onClose={onClose} closeId="x-close" />);
        const row = container.querySelector('.fhead')!;
        expect(row.querySelector('h2#x-title')).toHaveTextContent('Things');
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
        expect(onClose).toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Close' })).toHaveAttribute('id', 'x-close');
    });
});

describe('Disclosure', () => {
    it('toggles a row through its header button and shows the body only while open', () => {
        function Rows() {
            const [open, setOpen] = useState(false);
            return (
                <DisclosureList>
                    <Disclosure id="d-one" title="Connections" count={3} open={open} onToggle={setOpen}>
                        <p>Body</p>
                    </Disclosure>
                </DisclosureList>
            );
        }
        const { container } = render(<Rows />);
        const head = screen.getByRole('button', { name: 'Connections 3' });
        expect(container.querySelector('ul.disclosure-list > li.disclosure')).toBeTruthy();
        expect(head).toHaveAttribute('aria-expanded', 'false');
        expect(head).toHaveAttribute('aria-controls', 'd-one');
        expect(screen.queryByText('Body')).toBeNull();
        fireEvent.click(head);
        expect(head).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('region', { name: 'Connections 3' }).textContent).toBe('Body');
    });
});

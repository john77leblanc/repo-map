import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FlowchartDetails, FlowchartWorkspace } from './FlowchartWorkspace';
import { CodeReference } from '../../shared/ui/CodeReference';
import { fixture } from './testFixture';
import type { CodeRef } from '../../models/types';

const Reference = ({ reference }: { reference: CodeRef }) => <span>{reference.path}</span>;
describe('FlowchartWorkspace', () => {
    it('renders all legend symbols and shows change labels only for proposals', () => {
        const { vm, trace } = fixture();
        vm.setTrace(trace);
        const { container, rerender, unmount } = render(
            <FlowchartWorkspace vm={vm} CodeReference={Reference} />
        );
        const legend = container.querySelector('#flowchart-key')!;
        expect(legend.querySelectorAll('svg')).toHaveLength(6);
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
    it('composes separate sidebar details with doc labels and a Unicode decision arrow', () => {
        const { vm, trace } = fixture();
        vm.setTrace(trace);
        vm.select('a');
        vm.repo.docs.checkout[0].title = 'Checkout guide';
        const { container, unmount } = render(
            <>
                <FlowchartWorkspace vm={vm} CodeReference={CodeReference} details={null} />
                <FlowchartDetails vm={vm} CodeReference={CodeReference} />
            </>
        );
        expect(container.querySelectorAll('#fl-side')).toHaveLength(1);
        expect(container.querySelector('.fmain.details-closed')).toBeTruthy();
        expect(screen.getByText('Checkout guide')).toBeTruthy();
        expect(screen.getByText('Agent guide')).toBeTruthy();
        expect(screen.getByText('README.md#L3-L4')).toBeTruthy();
        expect(container.querySelector('#fl-side .fd')?.textContent).toBe('yes \u2192 Done');
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
            (screen.getByRole('button', { name: 'Copy Mermaid' }) as HTMLButtonElement).disabled
        ).toBe(true);
        expect(screen.getByText(/supporting walkthrough was kept/).id).toBe('flow-missing');
        unmount();
        vm.dispose();
    });
});

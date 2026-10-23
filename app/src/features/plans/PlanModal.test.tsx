import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PlansViewModel } from './PlansViewModel';
import { PlanModal } from './PlanModal';
import { fixture, raw } from '../traces/testFixtures';
import { normalizeTrace } from '../../models/trace';
it('renders cached plan files and modal controls', async () => {
    HTMLDialogElement.prototype.showModal = function () {
        this.open = true;
    };
    HTMLDialogElement.prototype.close = function () {
        this.open = false;
    };
    const { repo, services } = fixture();
    const vm = new PlansViewModel({
        repo,
        services,
        getPick: () => ({}),
        saveTrace: vi.fn(async () => {}),
    });
    await vm.open(
        normalizeTrace(
            {
                ...raw,
                intent: 'proposal',
                plan: {
                    tasks: [
                        { title: 'Validate', detail: 'Check expiry', files: ['new: coupons.mjs'] },
                    ],
                },
            },
            repo.map
        )
    );
    render(<PlanModal vm={vm} />);
    expect(screen.getByText('new: coupons.mjs')).toHaveClass('plan-files');
    expect(screen.getByText('Regenerate')).toBeEnabled();
    fireEvent.click(screen.getByText('Copy'));
    await vi.waitFor(() => expect(services.browser.copy).toHaveBeenCalled());
    fireEvent.click(screen.getByText('Close'));
    expect(vm.isOpen).toBe(false);
    vm.dispose();
});

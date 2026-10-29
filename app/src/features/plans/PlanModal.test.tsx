import { expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
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
    // Regenerate, Stop and Copy sit in the header, before Close
    expect([...document.querySelectorAll('#plan-dialog .fhead .acts button')].map((b) => b.id)).toEqual(['plan-generate', 'plan-stop', 'plan-copy', 'plan-close']);
    fireEvent.click(screen.getByText('Copy'));
    await vi.waitFor(() => expect(services.browser.copy).toHaveBeenCalled());
    fireEvent.click(screen.getByText('Close'));
    expect(vm.isOpen).toBe(false);
    vm.dispose();
});
it('shows a spinner on Regenerate while an existing plan is written again', async () => {
    HTMLDialogElement.prototype.showModal = function () {
        this.open = true;
    };
    const { repo, services } = fixture();
    repo.setAiAvailable(true);
    vi.mocked(services.api.stream).mockImplementation((_path, _body, signal) =>
        new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted')))) as never);
    const vm = new PlansViewModel({ repo, services, getPick: () => ({}), saveTrace: vi.fn(async () => {}) });
    await vm.open(normalizeTrace({ ...raw, intent: 'proposal', plan: { tasks: [{ title: 'Validate', detail: 'Check expiry', files: ['new: coupons.mjs'] }] } }, repo.map));
    render(<PlanModal vm={vm} />);
    await act(async () => fireEvent.click(screen.getByText('Regenerate')));
    const button = document.getElementById('plan-generate')!;
    expect(button).toHaveClass('busy');
    expect(button.textContent).toBe('Regenerating…');
    expect(button.getAttribute('aria-busy')).toBe('true');
    await act(async () => fireEvent.click(document.getElementById('plan-stop')!));
    expect(button).not.toHaveClass('busy');
    expect(button.textContent).toBe('Regenerate');
    vm.dispose();
});

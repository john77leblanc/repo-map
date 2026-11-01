import { expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { PlansViewModel } from './PlansViewModel';
import { PlanModal } from './PlanModal';
import { fixture, raw } from '../traces/testFixtures';
import { observable } from 'mobx';
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
it('shows steps as numbered cards that can be ticked done and reopened', async () => {
    HTMLDialogElement.prototype.showModal = function () {
        this.open = true;
    };
    const { repo, services } = fixture();
    const saveTrace = vi.fn(async () => {});
    const vm = new PlansViewModel({ repo, services, getPick: () => ({}), saveTrace });
    const tasks = [
        { title: 'Step 1: Validate', detail: 'Check expiry', files: ['new: coupons.mjs'] },
        { title: 'Wire', detail: 'Call it', files: [] },
    ];
    await vm.open(observable(normalizeTrace({ ...raw, intent: 'proposal', plan: { tasks } }, repo.map)));
    render(<PlanModal vm={vm} />);
    const cards = document.querySelectorAll('.plan-steps > .plan-step');
    expect(cards).toHaveLength(2);
    expect([...cards].map((c) => c.querySelector('.step-number')!.textContent)).toEqual(['1', '2']);
    expect(cards[0].querySelector('h3')!.textContent).toBe('Validate');
    await act(async () => fireEvent.click(screen.getByLabelText('Step 1 done')));
    expect(cards[0]).toHaveClass('done');
    expect(saveTrace).toHaveBeenCalledOnce();
    expect(screen.queryByText('Check expiry')).toBeNull();
    const title = screen.getByRole('button', { name: 'Validate' });
    expect(title).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(title);
    expect(screen.getByText('Check expiry')).toBeInTheDocument();
    expect(title).toHaveAttribute('aria-expanded', 'true');
    vm.dispose();
});
it('folds the lists after the steps, closed with a count, and keeps them open for the same plan', async () => {
    HTMLDialogElement.prototype.showModal = function () {
        this.open = true;
    };
    const { repo, services } = fixture();
    const vm = new PlansViewModel({ repo, services, getPick: () => ({}), saveTrace: vi.fn(async () => {}) });
    const tasks = [{ title: 'Validate', detail: 'Check expiry', files: [] }];
    const trace = observable(normalizeTrace({ ...raw, intent: 'proposal', plan: { tasks, risks: ['Clock skew', 'Reuse'], tests: [] } }, repo.map));
    await vm.open(trace);
    render(<PlanModal vm={vm} />);
    const heads = [...document.querySelectorAll('.plan-sections .disclosure-head')].slice(1);
    expect(heads.map((h) => h.querySelector('.disclosure-title')!.textContent)).toEqual(['Risks']);
    const risks = heads[0];
    expect(risks.querySelector('.disclosure-count')!.textContent).toBe('2');
    expect(risks).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Clock skew')).toBeNull();
    fireEvent.click(risks);
    expect(screen.getByText('Clock skew')).toBeInTheDocument();
    await act(async () => {
        vm.close();
        await vm.open(trace);
    });
    expect(screen.getByText('Clock skew')).toBeInTheDocument();
    await act(async () => {
        await vm.open(observable(normalizeTrace({ ...raw, title: 'Other', intent: 'proposal', plan: { tasks, risks: ['Clock skew'] } }, repo.map)));
    });
    expect(screen.queryByText('Clock skew')).toBeNull();
    vm.dispose();
});
it('heads the summary and folds the steps into a row that shows progress', async () => {
    HTMLDialogElement.prototype.showModal = function () {
        this.open = true;
    };
    const { repo, services } = fixture();
    const vm = new PlansViewModel({ repo, services, getPick: () => ({}), saveTrace: vi.fn(async () => {}) });
    const tasks = [
        { title: 'Validate', detail: 'Check expiry', files: [] },
        { title: 'Wire', detail: 'Call it', files: [] },
    ];
    const trace = observable(normalizeTrace({ ...raw, intent: 'proposal', plan: { summary: 'Add coupons', tasks, risks: ['Skew'] } }, repo.map));
    await vm.open(trace);
    render(<PlanModal vm={vm} />);
    const heading = screen.getByRole('heading', { name: 'Summary' });
    expect(heading.nextElementSibling).toHaveTextContent('Add coupons');
    const heads = [...document.querySelectorAll('.plan-sections .disclosure-head')];
    expect(heads.map((h) => h.querySelector('.disclosure-title')!.textContent)).toEqual(['Steps', 'Risks']);
    const steps = heads[0], count = () => steps.querySelector('.disclosure-count')!;
    expect(steps).toHaveAttribute('aria-expanded', 'true');
    expect(count().textContent).toBe('0/2');
    await act(async () => fireEvent.click(screen.getByLabelText('Step 1 done')));
    expect(count().textContent).toBe('1/2');
    expect(count()).not.toHaveClass('all-done');
    await act(async () => fireEvent.click(screen.getByLabelText('Step 2 done')));
    expect(count().textContent).toBe('2/2');
    expect(count()).toHaveClass('all-done');
    fireEvent.click(steps);
    expect(document.querySelector('.plan-step')).toBeNull();
    await act(async () => {
        vm.close();
        await vm.open(trace);
    });
    expect(steps).toHaveAttribute('aria-expanded', 'false');
    await act(async () => {
        await vm.open(observable(normalizeTrace({ ...raw, title: 'Other', intent: 'proposal', plan: { tasks } }, repo.map)));
    });
    expect(document.querySelector('#plan-steps-head')).toHaveAttribute('aria-expanded', 'true');
    vm.dispose();
});

import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { observable, runInAction } from 'mobx';
import { TraceViewModel } from './TraceViewModel';
import { SelectedTraceSidebar, TraceBackButton, TraceHome, TraceLibrary } from './TraceViews';
import { fixture, raw, flow } from './testFixtures';
import { normalizeTrace } from '../../models/trace';
beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    HTMLDialogElement.prototype.close = function () { this.open = false; };
});
it('renders composer outputs and imports errors with legacy classes', async () => {
    const { deps } = fixture();
    const vm = new TraceViewModel(deps);
    render(<TraceHome vm={vm} onRefreshAgents={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'New trace' }));
    expect(screen.getByLabelText('Question about the codebase')).toHaveFocus();
    fireEvent.click(screen.getByLabelText('Code architecture'));
    expect(vm.architecture).toBe(false);
    expect(screen.getByRole('dialog', { name: 'New trace' })).toBeVisible();
    expect(screen.getByRole('dialog', { name: 'New trace' })).toContainElement(document.getElementById('importbox'));
    fireEvent.click(screen.getByText('Import a trace code'));
    fireEvent.change(document.getElementById('importbox')!, { target: { value: 'bad code' } });
    fireEvent.click(screen.getByText('Add trace'));
    expect(await screen.findByText("That isn't a valid trace code.")).toHaveClass('err');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(vm.composerOpen).toBe(false);
    vm.dispose();
});
it('keeps node details out of the trace sidebar and shows the inferred warning in Flowchart view', () => {
    const { deps, repo } = fixture();
    const vm = new TraceViewModel(deps);
    const inferredFlow = { ...flow, nodes: [flow.nodes[0], { ...flow.nodes[1], inferred: true }] };
    vm.select(normalizeTrace({ ...raw, flow: inferredFlow }, repo.map), 'flowchart');
    const { container } = render(<SelectedTraceSidebar vm={vm} />);
    expect(container.querySelector('#fl-side')).toBeNull();
    expect(screen.getByText(/1 part is inferred/)).toBeVisible();
    vm.dispose();
});
it('numbers architecture steps upright with the shared pill and shows changes as chips before the title', () => {
    const { deps, repo } = fixture();
    const vm = new TraceViewModel({ ...deps, getWorkspace: () => 'architecture' });
    vm.select(normalizeTrace({ ...raw, summary: 'Places the order.', intent: 'proposal', proposal: { nodes: [{ id: 'checkout', status: 'modified' }] },
        refs: [{ path: 'src/checkout/CartPage.jsx', start: 3, end: 12, step: 'checkout' }] }, repo.map), 'architecture');
    const { container } = render(<SelectedTraceSidebar vm={vm} />);
    const step = container.querySelector('.steps li > button')!;
    expect(step.querySelector('i')).toBeNull();
    expect(step.querySelector('.step-number.n')?.textContent).toBe('1');
    expect(step.querySelector('b > .proposal-badge.modified:first-child')?.textContent).toBe('Modified');
    expect(step.textContent).not.toContain('[Modified]');
    // the reference is its own row, not laid out like the step button
    expect(container.querySelector('.steps li > .refs button.ref')).toBeTruthy();
    // Summary and Proposed change are Settings-style sections above the steps, closed by default
    const summary = container.querySelector<HTMLDetailsElement>('details.settings-section#trace-summary')!;
    const proposal = container.querySelector<HTMLDetailsElement>('details.settings-section#trace-proposal')!;
    expect(summary.open).toBe(false);
    expect(proposal.open).toBe(false);
    expect(proposal.querySelector('summary h2')?.textContent).toBe('Proposed change');
    // Trace steps is its own section after them, open, with the step count on the right
    const steps = proposal.nextElementSibling as HTMLDetailsElement;
    expect(steps.id).toBe('trace-steps');
    expect(steps.open).toBe(true);
    expect(steps.querySelector('summary h2')?.textContent).toBe('Trace steps');
    expect(steps.querySelector('summary .settings-section-count')?.textContent).toBe('1');
    expect(steps.querySelector('.settings-section-body > ol.steps')).toBeTruthy();
    proposal.open = true;
    fireEvent(proposal, new Event('toggle'));
    expect(vm.sections.proposal).toBe(true);
    vm.dispose();
});
it('shows a Planning… spinner chip on a library card while its plan is written', () => {
    const { deps, repo } = fixture();
    const busy = observable.box(true);
    const vm = new TraceViewModel({ ...deps, isPlanBusy: () => busy.get() });
    const trace = normalizeTrace({ ...raw, intent: 'proposal', proposal: { nodes: [] } }, repo.map);
    runInAction(() => { vm.items = [trace]; });
    const { container } = render(<TraceLibrary vm={vm} />);
    const chip = container.querySelector('#trace-list .trace-badge')!;
    expect(chip).toHaveClass('busy');
    expect(chip.textContent).toBe('Planning…');
    expect(chip.getAttribute('aria-label')).toBe('Writing implementation plan');
    act(() => busy.set(false));
    expect(container.querySelector('#trace-list .trace-badge')).not.toHaveClass('busy');
    expect(container.querySelector('#trace-list .trace-badge')?.textContent).toBe('Proposal');
    vm.dispose();
});
it('says Regenerating on the sidebar plan button when a plan is written again', () => {
    const { deps, repo } = fixture();
    const vm = new TraceViewModel({ ...deps, isPlanBusy: () => true });
    vm.select(normalizeTrace({ ...raw, intent: 'proposal', proposal: { nodes: [] },
        plan: { tasks: [{ title: 'Validate', detail: 'Check expiry', files: ['new: coupons.mjs'] }] } }, repo.map), 'architecture');
    render(<SelectedTraceSidebar vm={vm} />);
    const button = document.getElementById('trace-plan')!;
    expect(button).toHaveClass('busy');
    expect(button.textContent).toBe('Regenerating implementation plan…');
    vm.dispose();
});
it('supports copy fallback and confirmed deletion, with no output tabs in the sidebar', async () => {
    const { deps, repo, services } = fixture();
    const vm = new TraceViewModel(deps);
    const t = normalizeTrace({ ...raw, flow }, repo.map);
    t._doc = 'saved';
    vm.select(t, 'architecture');
    vi.mocked(services.browser.copy).mockRejectedValue(new Error('clipboard'));
    render(
        <>
            <TraceBackButton vm={vm} />
            <SelectedTraceSidebar vm={vm} />
        </>
    );
    expect(screen.getByText('Back to all traces')).toHaveFocus();
    expect(screen.queryByRole('tab')).toBeNull();
    fireEvent.click(screen.getByText('Copy trace code'));
    const code = await screen.findByLabelText('Trace code');
    await vi.waitFor(() => expect(code).toBeVisible());
    expect(code).toHaveFocus();
    fireEvent.click(screen.getByText('Delete'));
    expect(services.api.request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Delete trace and all outputs?'));
    await vi.waitFor(() =>
        expect(services.api.request).toHaveBeenCalledWith(
            '/api/traces/saved',
            expect.objectContaining({ method: 'DELETE' })
        )
    );
    vm.dispose();
});

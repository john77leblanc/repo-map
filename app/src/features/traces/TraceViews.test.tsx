import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TraceViewModel } from './TraceViewModel';
import { SelectedTraceSidebar, TraceBackButton, TraceHome } from './TraceViews';
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
it('supports tab keyboard navigation, copy fallback, and confirmed deletion', async () => {
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
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Architecture' }), { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Flowchart' })).toHaveFocus();
    expect(screen.queryByRole('tab', { name: 'Sitemap' })).toBeNull();
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

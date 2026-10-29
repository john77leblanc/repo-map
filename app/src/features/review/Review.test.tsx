import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TraceViewModel } from '../traces/TraceViewModel';
import { SelectedTraceSidebar, TraceHome } from '../traces/TraceViews';
import { fixture } from '../traces/testFixtures';
import { decodeTrace, encodeTrace, hasChanges, normalizeTrace } from '../../models/trace';
import { ReviewViewModel } from './ReviewViewModel';
import { ReviewModal } from './ReviewModal';
import type { Services } from '../../shared/services/contracts';

beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    HTMLDialogElement.prototype.close = function () { this.open = false; };
});

const HEAD = 'b'.repeat(40), BASE = 'a'.repeat(40);
const reviewRaw = {
    intent: 'review', title: 'Coupons', prompt: 'Review feature against main', summary: 'Adds coupons.', gaps: '',
    steps: [{ id: 'checkout', note: 'applies coupons', refs: [{ path: 'src/checkout.js', start: 1, end: 3, rev: HEAD }] },
        { id: 'proposal:coupons', note: 'new module', refs: [] }],
    edges: [],
    proposal: { rationale: 'A coupon module joins checkout.', nodes: [{ id: 'checkout', status: 'modified' }, { id: 'proposal:coupons', status: 'new', title: 'Coupons', group: 'shop' }], edges: [] },
    review: { kind: 'refs', base: 'main', head: 'feature', baseSha: BASE, headSha: HEAD, mergeBase: BASE,
        risks: ['No tests for expired codes'], questions: ['Is SAVE10 permanent?'], skipped: [],
        files: [{ path: 'src/coupons.js', status: 'A', additions: 4, deletions: 0, cards: ['proposal:coupons'], note: 'rules' },
            { path: 'src/checkout.js', status: 'M', additions: 2, deletions: 1, cards: ['checkout', 'ghost'], note: '' },
            { path: 'README.md', status: 'M', additions: 1, deletions: 0, cards: [], note: '' }] },
};

it('keeps a review through normalizing, saving and trace codes', () => {
    const { repo } = fixture();
    const trace = normalizeTrace(reviewRaw, repo.map);
    expect(trace.intent).toBe('review');
    expect(hasChanges(trace)).toBe(true);
    expect(trace.proposal?.nodes.map((n) => n.status)).toEqual(['modified', 'new']);
    expect(trace.refs[0].rev).toBe(HEAD);
    expect(trace.review?.files[1].cards).toEqual(['checkout']);
    expect(trace.plan).toBeNull();
    const again = decodeTrace(encodeTrace(trace), repo.map);
    expect(again.review?.headSha).toBe(HEAD);
    expect(again.refs[0].rev).toBe(HEAD);
});

it('groups changed files by card and opens each as a diff', () => {
    const { deps, repo } = fixture();
    const vm = new TraceViewModel(deps);
    const trace = normalizeTrace(reviewRaw, repo.map);
    const groups = vm.reviewFileGroups(trace);
    expect(groups.map((g) => [g.title, g.status, g.files.map((f) => f.path)])).toEqual([
        ['Checkout', 'modified', ['src/checkout.js']],
        ['Coupons', 'new', ['src/coupons.js']],
        ['Other files', undefined, ['README.md']],
    ]);
    expect(vm.fileReference(trace, trace.review!.files[0]).diff).toEqual({ base: BASE, head: HEAD });
    vm.dispose();
});

it('runs a review as a job, saves it, opens it and checks whether it is current', async () => {
    const { deps, services } = fixture();
    vi.mocked(services.api.stream).mockImplementation((async (url: string, _body: unknown, _s: AbortSignal, _p: unknown, onTitle?: (t: string) => void) => {
        expect(url).toBe('/api/review');
        onTitle?.('feature → main');
        return { trace: reviewRaw, used: { agent: 'api', model: '', effort: '', label: 'Test' } };
    }) as Services['api']['stream']);
    vi.mocked(services.api.request).mockImplementation((async (url: string) =>
        url === '/api/review/status' ? { state: 'stale', reason: 'feature has new commits.' } : { key: 'saved-review' }) as Services['api']['request']);
    const vm = new TraceViewModel(deps);
    const job = vm.startReview({ base: 'main', head: 'feature' })!;
    expect(job.review).toEqual({ base: 'main', head: 'feature' });
    expect(job.prompt).toBe('Review feature against main');
    expect(vm.startReview({ pr: '3' })).toBeNull();
    await waitFor(() => expect(job.state).toBe('completed'));
    expect(vi.mocked(services.api.stream).mock.calls[0][1]).toEqual({ base: 'main', head: 'feature', agent: 'api' });
    expect(vm.selected?.review?.headSha).toBe(HEAD);
    expect(vm.selected?.outputs.architecture).toBe(true);
    await waitFor(() => expect(vm.reviewState(vm.selected!)?.state).toBe('stale'));

    render(<SelectedTraceSidebar vm={vm} />);
    expect(screen.getByText('Out of date: feature has new commits.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.getByText('No tests for expired codes')).toBeVisible();
    act(() => vm.setSection('files', true));
    fireEvent.click(screen.getByRole('button', { name: /Coupons/ }));
    expect(screen.getByRole('button', { name: /coupons\.js/ })).toBeVisible();
    vm.dispose();
});

it('re-running a review replaces the saved one', async () => {
    const { deps, services, repo } = fixture();
    vi.mocked(services.api.stream).mockResolvedValue({ trace: reviewRaw });
    const vm = new TraceViewModel(deps);
    const saved = Object.assign(normalizeTrace(reviewRaw, repo.map), { _doc: 'old-review', createdAt: 5 });
    vm.select(saved);
    const job = vm.rerunReview(saved)!;
    expect(vm.rerunJob(saved)).toBe(job);
    expect(vi.mocked(services.api.stream).mock.calls[0][1]).toMatchObject({ base: 'main', head: 'feature' });
    await waitFor(() => expect(job.state).toBe('completed'));
    const put = vi.mocked(services.api.request).mock.calls.find(([url]) => url === '/api/traces/old-review');
    expect(put?.[1]?.method).toBe('PUT');
    expect(JSON.parse(String(put?.[1]?.body)).createdAt).toBe(5);
    vm.dispose();
});

it('the review window starts reviews from the form and from repo-map review', async () => {
    const { deps, services, repo } = fixture();
    repo.bootstrap!.config.defaultBranch = 'main';
    repo.bootstrap!.repo.branch = 'feature';
    let finish: (value: unknown) => void = () => {};
    vi.mocked(services.api.stream).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const traces = new TraceViewModel(deps);
    const vm = new ReviewViewModel({ repo, traces, getPickLabel: () => 'Test' });
    render(<><TraceHome vm={traces} onReview={vm.openNew} /><ReviewModal vm={vm} /></>);
    fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
    expect(screen.getByLabelText('Changes on')).toHaveValue('feature');
    expect(screen.getByLabelText('Compared with')).toHaveValue('main');
    fireEvent.click(screen.getByRole('tab', { name: 'Pull request' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(screen.getByText('Pick or enter a pull request.')).toBeVisible();
    act(() => vm.close());

    act(() => vm.fromQuery({ review: 'pr', pr: '12' }));
    expect(vm.open).toBe(true);
    expect(vi.mocked(services.api.stream).mock.calls[0][1]).toEqual({ pr: '12', agent: 'api' });
    expect(screen.getByRole('button', { name: 'Stop' })).toBeVisible();
    await act(async () => finish({ trace: reviewRaw }));
    await waitFor(() => expect(vm.open).toBe(false));
    expect(traces.selected?.intent).toBe('review');
    vm.dispose();
    traces.dispose();
});

const NOW = 2_000_000_000;
const refList = (aheadOf: string) => ({
    current: 'feature', defaultBranch: 'main', aheadOf, more: false,
    refs: [
        { name: 'feature', kind: 'local', sha: 'f', date: NOW - 3600 * 5, subject: 'Add coupons', ahead: aheadOf === 'origin/main' ? 3 : 0 },
        { name: 'main', kind: 'local', sha: 'm', date: NOW - 86400 * 2, subject: 'Release', ahead: 0, alsoRemote: true },
        { name: 'origin/old', kind: 'remote', sha: 'o', date: NOW - 86400 * 30, subject: 'Old', ahead: 0 },
        { name: 'v1.0.0', kind: 'tag', sha: 'm', date: NOW - 86400 * 400, subject: 'Release' },
    ],
});

function pickerFixture() {
    const { deps, services, repo } = fixture();
    repo.bootstrap!.config.defaultBranch = 'main';
    repo.bootstrap!.repo.branch = 'feature';
    const gets: string[] = [];
    vi.mocked(services.api.get).mockImplementation((async (url: string) => {
        gets.push(url);
        if (url.startsWith('/api/review/refs')) return refList(url.includes('base=feature') ? 'feature' : 'origin/main');
        if (url === '/api/review/prs') return { prs: [{ number: 7, title: 'Coupons', author: 'sam', head: 'feature', base: 'main', draft: true }] };
        return { traces: [] };
    }) as Services['api']['get']);
    const traces = new TraceViewModel(deps);
    const vm = new ReviewViewModel({ repo, traces, getPickLabel: () => 'Test', now: () => NOW });
    return { vm, traces, services, gets };
}

it('lists branches and tags with their age and how far ahead they are, greying out ones with nothing to review', async () => {
    const { vm, traces } = pickerFixture();
    vm.openNew();
    await waitFor(() => expect(vm.refs).not.toBeNull());
    expect(vm.headBox.value).toBe('feature');
    expect(vm.baseBox.value).toBe('main');
    expect(vm.headBox.groups.map((g) => g.group)).toEqual(['Branches', 'Remote branches', 'Tags']);
    const head = Object.fromEntries(vm.headBox.options.map((o) => [o.value, o]));
    expect(head.feature.label).toBe('● feature');
    expect(head.feature.meta).toBe('5h · 3 ahead');
    expect(head.main.muted).toBe(true);
    expect(head.main.meta).toBe('2d · nothing to review');
    expect(head['v1.0.0'].meta).toBe('1y');
    // the base list starts with the default branch, without counts
    expect(vm.baseBox.options[0]).toMatchObject({ value: 'main', group: 'Default branch', meta: '2d' });
    expect(vm.nothingToReview).toBe(false);
    vm.dispose();
    traces.dispose();
});

it('reloads the counts when the base settles, and warns when the head has nothing to review', async () => {
    vi.useFakeTimers();
    try {
        const { vm, traces, gets } = pickerFixture();
        vm.openNew();
        await vi.waitFor(() => expect(vm.refs).not.toBeNull());
        vm.setBase('feat');
        vm.setBase('feature');
        expect(gets.filter((u) => u.startsWith('/api/review/refs'))).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(300);
        expect(gets.filter((u) => u.startsWith('/api/review/refs'))).toEqual(['/api/review/refs?base=main', '/api/review/refs?base=feature']);
        await vi.waitFor(() => expect(vm.refs?.aheadOf).toBe('feature'));
        expect(vm.nothingToReview).toBe(true);
        vm.dispose();
        traces.dispose();
    } finally {
        vi.useRealTimers();
    }
});

it('pull request mode lists open pull requests; Fetch refreshes the lists', async () => {
    const { vm, traces, services, gets } = pickerFixture();
    render(<ReviewModal vm={vm} />);
    act(() => vm.openNew());
    fireEvent.click(screen.getByRole('tab', { name: 'Pull request' }));
    await waitFor(() => expect(vm.prBox.options).toHaveLength(1));
    expect(vm.prBox.options[0]).toMatchObject({ value: '7', label: '#7 Coupons', meta: 'sam · feature → main · draft' });
    const input = screen.getByRole('combobox', { name: 'Pull request' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(vm.request).toEqual({ pr: '7' });
    vi.mocked(services.api.request).mockResolvedValue({ fetchedAt: 'now' });
    const before = gets.length;
    fireEvent.click(screen.getByRole('button', { name: 'Fetch' }));
    await waitFor(() => expect(screen.getByText('Fetched just now.')).toBeVisible());
    expect(vi.mocked(services.api.request).mock.calls.at(-1)?.[0]).toBe('/api/review/fetch');
    expect(gets.slice(before)).toEqual(expect.arrayContaining(['/api/review/prs', '/api/review/refs?base=main']));
    vm.dispose();
    traces.dispose();
});

it('says why pull requests are missing when gh is unavailable', async () => {
    const { vm, traces, services } = pickerFixture();
    vi.mocked(services.api.get).mockImplementation((async (url: string) =>
        url === '/api/review/prs' ? { prs: [], reason: "The GitHub CLI (gh) isn't installed." } : refList('origin/main')) as Services['api']['get']);
    vm.openNew();
    vm.setMode('pr');
    await waitFor(() => expect(vm.prsReason).toBe("The GitHub CLI (gh) isn't installed."));
    expect(vm.prBox.options).toEqual([]);
    vm.dispose();
    traces.dispose();
});

it('switches modes with tabs, and locks the other tabs while a review runs', async () => {
    const { vm, traces, services } = pickerFixture();
    vi.mocked(services.api.stream).mockImplementation(() => new Promise(() => {}));
    render(<ReviewModal vm={vm} />);
    act(() => vm.openNew());
    const tabs = screen.getByRole('tablist', { name: 'What to review' });
    expect(tabs).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Branches' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toContainElement(screen.getByRole('combobox', { name: 'Changes on' }));
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Branches' }), { key: 'ArrowRight' });
    expect(vm.mode).toBe('pr');
    expect(screen.getByRole('tab', { name: 'Pull request' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('combobox', { name: 'Pull request' })).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Local changes' }));
    expect(screen.queryByRole('combobox', { name: 'Changes on' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(vm.busy).toBe(true);
    expect(screen.getByRole('tab', { name: 'Local changes' })).toBeEnabled();
    expect(screen.getByRole('tab', { name: 'Branches' })).toBeDisabled();
    expect(screen.getByRole('tab', { name: 'Pull request' })).toBeDisabled();
    act(() => vm.stop());
    vm.dispose();
    traces.dispose();
});

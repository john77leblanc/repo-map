import { useEffect, useRef } from 'react';
import { Observer, observer } from 'mobx-react-lite';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { ProgressLine } from '../../shared/ui/ProgressLine';
import { Tabs } from '../../shared/ui/Tabs';
import { OutputsSection } from '../traces/OutputsSection';
import { DescribeFields, TraceImport } from '../traces/TraceViews';
import { ReviewFields } from '../review/ReviewFields';
import { COMPOSER_TABS, type ComposerTab, type ComposerViewModel, type OutputRow } from './ComposerViewModel';

export interface ComposerModalProps {
    vm: ComposerViewModel;
    onRefreshAgents?: () => void;
}

const STATE_LABELS: Record<OutputRow['state'], string> = { waiting: 'Waiting', done: 'Ready', missing: 'Missing', stopped: 'Not made' };

/** The form: the tab's fields, Outputs, then Create trace / Review. */
const ComposerForm = observer(function ComposerForm({ vm, onRefreshAgents }: ComposerModalProps) {
    const { traces, review } = vm.deps;
    const describe = vm.tab === 'describe';
    const blocked = !traces.repo.aiAvailable || (traces.sitemap && (traces.deps.sitemap?.loading || traces.deps.sitemap?.busy));
    const statusId = describe ? 'status' : 'review-status';
    return (
        <form id={describe ? 'composer' : 'review-form'} onSubmit={(e) => { e.preventDefault(); vm.submit(); }}>
            {describe ? <DescribeFields vm={traces} onSubmit={vm.submit} /> : <ReviewFields vm={review} />}
            <OutputsSection vm={traces} open={vm.outputsOpen} onToggle={vm.toggleOutputs} count={vm.outputCount}
                review={!describe} disabled={!traces.repo.aiAvailable} />
            <div className="trace-actions">
                <button className="btn primary" id={describe ? 'run' : 'review-run'} type="submit" disabled={!!blocked}>
                    {describe ? (vm.job ? 'Retry trace' : 'Create trace') : vm.job ? 'Retry review' : 'Review'}
                </button>
                {onRefreshAgents && <button className="iconbtn" id="pick-refresh" type="button"
                    title="Look for AI tools and models again" aria-label="Look for AI tools and models again" onClick={onRefreshAgents}>
                    <svg viewBox="0 0 16 16"><path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5v3h-3" /></svg>
                </button>}
            </div>
            {/* form problems only; a job's progress has its own screen */}
            <p className={'status trace-status' + (vm.error ? ' err' : '')} id={statusId} aria-live="polite" title={vm.status}>
                {vm.job ? '' : vm.status}
            </p>
            {describe && <TraceImport vm={traces} />}
        </form>
    );
});

/** A running or finished job: its progress history, each requested output, then Stop or Retry / Delete. */
const ComposerProgress = observer(function ComposerProgress({ vm }: ComposerModalProps) {
    const job = vm.job!;
    const review = vm.isReview;
    const prompt = review ? '' : job.prompt;
    return (
        <section className="composer-progress" aria-label={review ? 'Review progress' : 'Trace progress'}>
            {prompt && <p className="composer-prompt" title={prompt}>{prompt}</p>}
            <ProgressLine id={review ? 'review-status' : 'status'} text={job.status || job.progress.last}
                entries={job.progress.entries} busy={job.busy} error={job.error} />
            <ul className="output-progress" aria-label="Outputs">
                {vm.outputRows.map((row) => (
                    <li key={row.id} className={'s-' + row.state} data-output={row.id}>
                        <span className="output-progress-mark" aria-hidden="true" />
                        <span className="output-progress-label">{row.label}</span>
                        <span className="output-progress-state">{STATE_LABELS[row.state]}</span>
                    </li>
                ))}
            </ul>
            <div className="trace-actions">
                {job.busy
                    ? <button className="btn" id={review ? 'review-stop' : 'stop'} type="button" disabled={job.state === 'saving'} onClick={vm.stop}>Stop</button>
                    : <>
                        <button className="btn primary" id={review ? 'review-retry' : 'retry'} type="button" onClick={vm.retry}
                            disabled={!vm.deps.traces.repo.aiAvailable}>{review ? 'Retry review' : 'Retry trace'}</button>
                        <button className="btn" id="composer-edit" type="button" onClick={vm.backToForm}>Back to form</button>
                        {vm.canDelete && <button className="btn" id={review ? 'review-delete' : 'delete-job'} type="button" onClick={vm.discard}
                            title={'Remove this failed ' + (review ? 'review' : 'trace') + ' from Saved traces'}>Delete</button>}
                    </>}
            </div>
            {job.busy && <p className="hint">You can close this window; the {review ? 'review' : 'trace'} keeps running and appears with your traces.</p>}
        </section>
    );
});

/** The New trace window: Describe / Branches / Pull request / Local changes, then the job's progress. */
export const ComposerModal = observer(function ComposerModal({ vm, onRefreshAgents }: ComposerModalProps) {
    const dialog = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        const element = dialog.current;
        if (!element) return;
        if (vm.open && !element.open) {
            element.showModal?.();
            element.querySelector<HTMLElement>('#prompt:not([disabled]), .modal-body input:not([disabled])')?.focus();
        } else if (!vm.open && element.open) element.close();
    }, [vm.open]);
    // a new tab's first field takes focus
    useEffect(() => {
        if (!vm.open || vm.showProgress) return;
        dialog.current?.querySelector<HTMLElement>('#prompt:not([disabled]), .review-fields input:not([disabled])')?.focus();
    }, [vm.tab]);
    const title = vm.job ? vm.job.title || <span className="trace-title-skeleton">Preparing title...</span> : vm.title;
    return (
        <dialog ref={dialog} id="trace-dialog" className="modal" aria-labelledby="new-trace-title"
            onCancel={(e) => { e.preventDefault(); vm.close(); }}
            onClose={() => { if (vm.open) vm.close(); }}>
            <ModalHeader titleId="new-trace-title" onClose={vm.close} title={title} />
            {vm.open && (vm.showProgress
                ? <div className="modal-body"><ComposerProgress vm={vm} /></div>
                : <Tabs<ComposerTab> idPrefix="compose" label="What to trace" className="composer-tabs" panelClassName="modal-body"
                    active={vm.tab} onChange={vm.setTab}
                    tabs={COMPOSER_TABS.map((t) => ({ ...t, disabled: vm.busy && t.id !== vm.tab }))}>
                    {() => <Observer>{() => <ComposerForm vm={vm} onRefreshAgents={onRefreshAgents} />}</Observer>}
                </Tabs>)}
        </dialog>
    );
});

import { useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { Combobox } from '../../shared/ui/Combobox';
import { Tabs } from '../../shared/ui/Tabs';
import type { ReviewMode, ReviewViewModel } from './ReviewViewModel';

const MODES: { id: ReviewMode; label: string }[] = [
    { id: 'refs', label: 'Branches' },
    { id: 'pr', label: 'Pull request' },
    { id: 'local', label: 'Local changes' },
];
const NO_REF_MATCH = 'No branches or tags match; the typed name is used';

/** The open tab's content: the fields for that kind of review, Fetch, then Review / Stop. */
const ReviewPanel = observer(function ReviewPanel({ vm }: { vm: ReviewViewModel }) {
    const locked = vm.busy;
    const empty = vm.refsLoading ? 'Loading branches…' : NO_REF_MATCH;
    return (
        <>
            <p className="hint" id="review-hint">
                {vm.agentLabel} reads the changes and the code around them, then shows what they do on the map,
                as a flowchart and on the sitemap, with the changed files under each card. The review is saved with your traces.
            </p>
            {!vm.aiAvailable && <p className="noai" id="review-noai"><b>Reviews are off on this machine.</b> They need an AI tool: run <code>repo-map doctor</code> to see your options.</p>}
            <form onSubmit={(e) => { e.preventDefault(); vm.start(); }}>
                <fieldset disabled={locked} className="review-fields">
                    {vm.mode === 'pr' && <>
                        <label htmlFor="review-pr">Pull request</label>
                        <Combobox model={vm.prBox} id="review-pr" placeholder="Pick one, or type 12 or its URL"
                            toggleLabel="Open pull requests" empty={vm.prsLoading ? 'Loading pull requests…' : 'No open pull requests match'} />
                        <p className="hint" id="review-pr-hint">{vm.prsLoading ? 'Loading open pull requests…' : vm.prsReason ? vm.prsReason + ' ' : ''}
                            Uses the GitHub CLI (<code>gh</code>), signed in. Its code is fetched if it isn't here yet; your branch stays as it is.
                            {!vm.github && ' This repo has no GitHub remote, so this may not work.'}</p>
                    </>}
                    {vm.mode === 'refs' && <>
                        <label htmlFor="review-head">Changes on</label>
                        <Combobox model={vm.headBox} id="review-head" placeholder={vm.branch || 'HEAD'} toggleLabel="Branches and tags" empty={empty} />
                        {vm.nothingToReview && <p className="hint err" id="review-nothing">{vm.head || vm.branch} has no commits that {vm.base || vm.defaultBranch} doesn't have.</p>}
                        <label htmlFor="review-base">Compared with</label>
                        <Combobox model={vm.baseBox} id="review-base" placeholder={vm.defaultBranch} toggleLabel="Branches and tags to compare with" empty={empty} />
                        <p className="hint">Pick or type a branch, tag or commit. Only the changes since they split are reviewed, as in a pull request.</p>
                    </>}
                    {vm.mode === 'local' && <>
                        <label htmlFor="review-base">Compared with</label>
                        <Combobox model={vm.baseBox} id="review-base" placeholder={vm.defaultBranch} toggleLabel="Branches and tags to compare with" empty={empty} />
                        <p className="hint">Reviews {vm.branch || 'this branch'} as it is in your checkout, uncommitted changes included (new files only once added with git).</p>
                    </>}
                    {vm.refsError && vm.mode !== 'pr' && <p className="hint err" id="review-refs-error">{vm.refsError}</p>}
                    <div className="review-fetch">
                        <button className="btn sm" id="review-fetch" type="button" disabled={vm.fetching} onClick={() => void vm.fetchRemote()}
                            title="Run git fetch to see new branches and pull request code from origin">
                            {vm.fetching ? 'Fetching…' : 'Fetch'}
                        </button>
                        <span className={'status' + (vm.fetching ? ' busy' : '') + (vm.fetchError ? ' err' : '')} aria-live="polite">
                            {vm.fetchMessage || (vm.refs?.more ? 'Showing the 500 most recent branches and tags.' : 'Branches from origin are as of your last fetch.')}
                        </span>
                    </div>
                </fieldset>
                <div className="trace-actions">
                    <button className="btn primary" id="review-run" type="submit" disabled={locked || !vm.aiAvailable}>
                        {vm.busy ? 'Reviewing…' : vm.job ? 'Retry review' : 'Review'}
                    </button>
                    <span className={'status' + (vm.busy ? ' busy' : '') + (vm.error ? ' err' : '')} id="review-status" aria-live="polite" title={vm.status}>
                        {vm.status}
                    </span>
                    <button className="btn" id="review-stop" type="button" hidden={!vm.busy} disabled={vm.job?.state === 'saving'} onClick={vm.stop}>Stop</button>
                </div>
                {vm.busy && <p className="hint">You can close this window; the review keeps running and appears with your traces.</p>}
            </form>
        </>
    );
});

/** The "Review changes" window: tabs for what to compare, then the review's progress. */
export const ReviewModal = observer(function ReviewModal({ vm }: { vm: ReviewViewModel }) {
    const dialog = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        const element = dialog.current;
        if (!element) return;
        if (vm.open && !element.open) {
            element.showModal?.();
            element.querySelector<HTMLInputElement>('input:not([disabled])')?.focus();
        } else if (!vm.open && element.open) element.close();
    }, [vm.open]);
    return (
        <dialog ref={dialog} id="review-dialog" className="modal" aria-labelledby="review-title"
            onCancel={(e) => { e.preventDefault(); vm.close(); }}
            onClose={() => { if (vm.open) vm.close(); }}>
            <ModalHeader titleId="review-title" closeId="review-close" onClose={vm.close} title={vm.title} />
            {vm.open && <section className="modal-body review-form">
                {/* while a review runs, only its own tab can be shown */}
                <Tabs idPrefix="review-mode" label="What to review" className="review-mode-tabs" active={vm.mode} onChange={vm.setMode}
                    tabs={MODES.map((m) => ({ ...m, disabled: vm.busy && m.id !== vm.mode }))}>
                    {() => <ReviewPanel vm={vm} />}
                </Tabs>
            </section>}
        </dialog>
    );
});

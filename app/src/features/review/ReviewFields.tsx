import { observer } from 'mobx-react-lite';
import { Combobox } from '../../shared/ui/Combobox';
import type { ReviewViewModel } from './ReviewViewModel';

const NO_REF_MATCH = 'No branches or tags match; the typed name is used';

/** A review tab's fields in the New trace window: what to compare for that kind of review, then Fetch. */
export const ReviewFields = observer(function ReviewFields({ vm }: { vm: ReviewViewModel }) {
    const empty = vm.refsLoading ? 'Loading branches…' : NO_REF_MATCH;
    return (
        <>
            <p className="hint" id="review-hint">
                {vm.agentLabel} reads the changes and the code around them, then shows what they do on the map,
                with the changed files under each card, and in the other outputs you pick. The review is saved with your traces.
            </p>
            {!vm.aiAvailable && <p className="noai" id="review-noai"><b>Reviews are off on this machine.</b> They need an AI tool: run <code>repo-map doctor</code> to see your options.</p>}
            <fieldset disabled={vm.busy} className="review-fields">
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
        </>
    );
});

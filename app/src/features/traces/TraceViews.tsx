import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { CodeReference } from '../../shared/ui/CodeReference';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { StepNumber } from '../../shared/ui/StepNumber';
import { SettingsSection } from '../../shared/ui/SettingsSection';
import { CHANGE_LABELS } from '../../../../lib/proposal.mjs';
import { reviewLabel } from '../../../../lib/review-data.mjs';
import { Disclosure, DisclosureList } from '../../shared/ui/Disclosure';
import type { TraceJob } from './TraceJob';
import type { TraceViewModel } from './TraceViewModel';
import type { Trace, Workspace } from '../../models/types';
export interface TraceViewProps {
    vm: TraceViewModel;
}
export interface TraceHomeProps extends TraceViewProps {
    onRefreshAgents?: () => void;
    /** Open the "Review changes" window. */
    onReview?: () => void;
}
function OutputOption({ id, label, description, checked, onChange }: {
    id: string;
    label: string;
    description: string;
    checked: boolean;
    onChange(value: boolean): void;
}) {
    const [helpOpen, setHelpOpen] = useState(false);
    return (
        <div className="output-option">
            <label className="opt" htmlFor={id}>
                <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
                {label}
            </label>
            <span className="output-help" onMouseEnter={() => setHelpOpen(true)} onMouseLeave={() => setHelpOpen(false)}>
                <button className="output-help-button" type="button" aria-label={'About ' + label}
                    aria-describedby={id + '-help'} onFocus={() => setHelpOpen(true)} onBlur={() => setHelpOpen(false)}
                    onClick={() => setHelpOpen(true)} onKeyDown={(e) => {
                        if (e.key === 'Escape' && helpOpen) {
                            e.preventDefault();
                            e.stopPropagation();
                            setHelpOpen(false);
                        }
                    }}>
                    <span aria-hidden="true">?</span>
                </button>
                <span id={id + '-help'} className="output-tooltip" role="tooltip" hidden={!helpOpen}>{description}</span>
            </span>
        </div>
    );
}
export const TraceComposer = observer(function TraceComposer({
    vm,
    onRefreshAgents,
    inline = false,
}: TraceHomeProps & { inline?: boolean }) {
    const prompt = useRef<HTMLTextAreaElement>(null);
    useEffect(() => {
        if (inline && vm.editing) prompt.current?.focus();
    }, [inline, !!vm.editing]);
    return (
        <section id={inline ? 'trace-editor' : 'composer'} className={inline ? undefined : 'modal-body'} hidden={!inline && !vm.composerOpen}>
            {!inline && <>
                <p className="hint" id="trace-hint">
                    Ask how a process works or where a new feature would fit. {vm.deps.getPickLabel()}{' '}
                    reads the map and local code to explain and illustrate the answer.
                </p>
                <div className="noai" id="noai" hidden={vm.repo.aiAvailable}>
                    <b>Tracing is off on this machine.</b>{' '}
                    <span id="noai-why">{vm.repo.bootstrap?.ai.reason}</span> Run{' '}
                    <code>repo-map doctor</code> to see your options, or set one up with the package's SETUP.md.
                    You can still <a href="#importbox" onClick={(e) => {
                        e.preventDefault();
                        const box = document.getElementById('importbox');
                        const details = box?.closest('details');
                        if (details) details.open = true;
                        box?.focus();
                    }}>import a trace code</a> shared by a teammate.
                </div>
            </>}
            <textarea
                ref={prompt}
                id={inline ? 'trace-prompt' : 'prompt'}
                maxLength={4000}
                disabled={!vm.repo.aiAvailable || vm.busy}
                aria-label={inline ? 'Trace prompt' : 'Question about the codebase'}
                aria-describedby={inline ? undefined : 'trace-hint'}
                placeholder="e.g. How does checkout work? Where would coupon support fit?"
                value={vm.prompt}
                onChange={(e) => vm.setPrompt(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        void vm.runTrace();
                    }
                }}
            />
            {(!inline || vm.editing) && <>
                {inline && <p className="hint">Regeneration replaces this trace when all requested outputs are ready. Its implementation plan will be cleared.</p>}
                <div className="trace-outputs">
                    <fieldset className="output-options" disabled={!vm.repo.aiAvailable || vm.busy}>
                        <legend>Outputs</legend>
                        <OutputOption id="witharchitecture" label="Code architecture" checked={vm.architecture}
                            description="Highlights the process on the repository map."
                            onChange={(value) => vm.setOutput('architecture', value)} />
                        <OutputOption id="withflow" label="Flowchart" checked={vm.flowchart}
                            description="Shows decisions and outcomes in the process."
                            onChange={(value) => vm.setOutput('flowchart', value)} />
                        <OutputOption id="withsitemap" label="Sitemap" checked={vm.sitemap}
                            description="Follows screens and navigation, including proposed changes."
                            onChange={(value) => vm.setOutput('sitemap', value)} />
                        {vm.sitemap && !vm.deps.sitemap?.sitemap && <div>
                            <p>Generate the repository sitemap before tracing screens. Your question will stay here.</p>
                            <button className="btn" type="button" disabled={vm.deps.sitemap?.busy || vm.deps.sitemap?.loading}
                                onClick={() => void vm.deps.sitemap?.generate()}>Generate sitemap</button>
                            {vm.deps.sitemap?.busy && <button className="btn" type="button" onClick={vm.deps.sitemap.stop}>Stop sitemap generation</button>}
                            <p role="status">{vm.deps.sitemap?.message}</p>
                        </div>}
                    </fieldset>
                </div>
                <div className="trace-actions">
                    <button className="btn primary" id="run" type="button"
                        disabled={vm.busy || !vm.repo.aiAvailable || (vm.sitemap && (vm.deps.sitemap?.loading || vm.deps.sitemap?.busy))}
                        onClick={() => void vm.runTrace()}>
                        {vm.editing ? 'Regenerate' : vm.activeJob ? (vm.activeJob.busy ? 'Creating trace...' : 'Retry trace') : 'Create trace'}
                    </button>
                    {onRefreshAgents && <button className="iconbtn" id="pick-refresh" type="button"
                        title="Look for AI tools and models again" aria-label="Look for AI tools and models again" onClick={onRefreshAgents}>
                        <svg viewBox="0 0 16 16"><path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5v3h-3" /></svg>
                    </button>}
                    <span className={'status' + (vm.busy ? ' busy' : '') + (vm.error ? ' err' : '')} id="status" aria-live="polite" title={vm.status}>
                        {vm.status}
                    </span>
                    {vm.editing && <button className="btn" type="button" disabled={vm.savingRevision} onClick={vm.cancelEdit}>Cancel</button>}
                    <button className="btn" disabled={vm.saving} id="stop" type="button" hidden={!vm.busy} onClick={vm.stop}>Stop</button>
                </div>
            </>}
            {!inline && <TraceImport vm={vm} />}
        </section>
    );
});
const TraceImport = observer(function TraceImport({ vm }: TraceViewProps) {
    return (
        <details className="imp">
            <summary>Import a trace code</summary>
            <textarea
                id="importbox"
                aria-label="Trace code to import"
                placeholder="Paste a trace code (rmap1:…)"
                value={vm.importCode}
                onChange={(e) => vm.setImportCode(e.target.value)}
            />
            <div className="row">
                <button
                    className="btn sm"
                    id="importbtn"
                    type="button"
                    onClick={async (e) => {
                        const details = e.currentTarget.closest('details');
                        await vm.importTrace();
                        if (!vm.importMessage && details) details.open = false;
                    }}
                >
                    Add trace
                </button>
                <span className={'status' + (vm.importMessage ? ' err' : '')} id="importmsg">
                    {vm.importMessage}
                </span>
            </div>
        </details>
    );
});
const NewTraceModal = observer(function NewTraceModal({ vm, onRefreshAgents }: TraceHomeProps) {
    const dialog = useRef<HTMLDialogElement>(null);
    const open = vm.composerOpen && !vm.editing && !vm.selected;
    useEffect(() => {
        const element = dialog.current;
        if (!element) return;
        if (open && !element.open) {
            element.showModal();
            element.querySelector<HTMLTextAreaElement>('#prompt')?.focus();
        } else if (!open && element.open) element.close();
    }, [open]);
    return (
        <dialog ref={dialog} id="trace-dialog" className="modal" aria-labelledby="new-trace-title"
            onCancel={(e) => { e.preventDefault(); vm.closeComposer(); }}
            onClose={() => { if (open) vm.closeComposer(); }}>
            <ModalHeader titleId="new-trace-title" onClose={vm.closeComposer} title={vm.activeJob
                ? vm.activeJob.title || <span className="trace-title-skeleton">Preparing title...</span>
                : 'New trace'} />
            {!vm.selected && !vm.editing && <TraceComposer vm={vm} onRefreshAgents={onRefreshAgents} />}
        </dialog>
    );
});
const TraceJobCard = observer(function TraceJobCard({ vm, job }: TraceViewProps & { job: TraceJob }) {
    return (
        <li className="ti trace-card trace-job" data-job-id={job.id}>
            <button className="trace-open" type="button" aria-busy={job.busy} onClick={() => void vm.openJob(job)}>
                <span className="trace-card-title" title={job.title || undefined}>{job.title || <span className="trace-title-skeleton">Preparing title...</span>}</span>
                <span className="trace-prompt" title={job.prompt}>{job.prompt}</span>
                <span className={'status' + (job.busy ? ' busy' : '') + (job.error ? ' err' : '')}>
                    {job.state === 'running' ? 'Agent working' : job.state === 'saving' ? 'Saving trace...' : job.status}
                </span>
            </button>
        </li>
    );
});
export const TraceLibrary = observer(function TraceLibrary({ vm }: TraceViewProps) {
    return (
        <section>
            <h2>
                Saved traces{' '}
                <span className="gc" id="savedcount">
                    {vm.rows.length + vm.jobRows.length || ''}
                </span>
            </h2>
            <p className="hint" id="store-note">
                {vm.storeNote}
            </p>
            <ul className="trace-list" id="trace-list">
                {vm.jobRows.map((job) => <TraceJobCard key={job.id} vm={vm} job={job} />)}
                {vm.rows.map((trace, i) => (
                    <li className="ti trace-card" key={trace.key || trace._doc || i}>
                        <button
                            className="trace-open"
                            type="button"
                            onClick={() => void vm.openTrace(trace)}
                        >
                            <span className="trace-card-head">
                                <span className="trace-card-title" title={trace.title}>{trace.title}</span>
                                {trace.intent === 'review' && <span className="trace-badge review">{reviewLabel(trace.review) || 'Review'}</span>}
                                {trace.intent === 'proposal' && (vm.isPlanBusy(trace)
                                    ? <span className="trace-badge busy" role="status" aria-label="Writing implementation plan">Planning…</span>
                                    : <span className="trace-badge">{trace.plan ? 'Plan' : 'Proposal'}</span>)}
                            </span>
                            <span className="trace-prompt" title={trace.prompt || undefined}>
                                {trace.prompt || 'No prompt saved.'}
                            </span>
                            {trace === vm.temp && (
                                <span className="trace-save-note">Not saved</span>
                            )}
                        </button>
                    </li>
                ))}
            </ul>
            <p className="empty" id="saved-empty" hidden={vm.rows.length + vm.jobRows.length > 0}>
                No saved traces yet. Create a trace, or import one from a teammate.
            </p>

        </section>
    );
});
export const TraceHome = observer(function TraceHome({
    vm,
    onRefreshAgents,
    onReview,
}: TraceHomeProps) {
    return (
        <div id="sidebar-home" hidden={!!vm.selected}>
            <section className="repo-summary" aria-label="Repository">
                <h1 id="map-name">{vm.repo.bootstrap?.config.name || 'Repo Map'}</h1>
            </section>
            <button
                className="btn primary"
                id="new-trace"
                hidden={!!vm.editing}
                type="button"
                aria-expanded={vm.composerOpen}
                aria-haspopup="dialog"
                aria-controls="trace-dialog"
                onClick={vm.toggleComposer}
            >
                New trace
            </button>
            {onReview && (
                <button className="btn" id="review-changes" hidden={!!vm.editing} type="button" aria-haspopup="dialog"
                    aria-controls="review-dialog" onClick={onReview}
                    title="See what a pull request, branch or your local changes do, on the map">
                    Review changes
                </button>
            )}
            <hr className="trace-library-divider" hidden={!!vm.editing} />
            <div className="pane" id="pane-traces">
                {!vm.editing && <TraceLibrary vm={vm} />}
            </div>
            <NewTraceModal vm={vm} onRefreshAgents={onRefreshAgents} />
        </div>
    );
});
const TracePromptActions = observer(function TracePromptActions({ vm, trace }: TraceViewProps & { trace: Trace }) {
    const [armed, setArmed] = useState(false);
    useEffect(() => {
        if (!armed) return;
        const timer = setTimeout(() => setArmed(false), 3000);
        return () => clearTimeout(timer);
    }, [armed]);
    return (
        <div className="trace-prompt-actions">
            {trace.intent !== 'review' && <button className="btn sm" type="button" disabled={!trace._doc || !vm.repo.aiAvailable || vm.busy}
                onClick={() => vm.editPrompt(trace)}>Edit</button>}
            <button className="btn sm danger" type="button" disabled={!trace._doc || vm.busy}
                onClick={() => {
                    if (armed) void vm.removeTrace(trace);
                    else setArmed(true);
                }}>
                {armed ? 'Delete trace and all outputs?' : 'Delete'}
            </button>
        </div>
    );
});
const TraceActions = observer(function TraceActions({ vm, trace }: TraceViewProps & { trace: Trace }) {
    return (
        <div className="sva">
            <button
                className="linkbtn"
                data-a="copy"
                type="button"
                onClick={() => void vm.copyCode(trace)}
            >
                {vm.codeCopied(trace) ? 'Copied!' : 'Copy trace code'}
            </button>
            {(!trace._doc || vm.temp === trace) && (
                <button
                    className="linkbtn"
                    data-a="save"
                    type="button"
                    onClick={() => void vm.saveExisting(trace)}
                >
                    Retry saving
                </button>
            )}
        </div>
    );
});
/** What a review compared, whether it still matches the code, and Re-run. */
const ReviewHeader = observer(function ReviewHeader({ vm, trace }: TraceViewProps & { trace: Trace }) {
    const r = trace.review!;
    const state = vm.reviewState(trace);
    const rerun = vm.rerunJob(trace);
    const short = (sha: string) => sha.slice(0, 7);
    return (
        <div className="review-head" id="review-head">
            <p className="review-range">
                <span className="trace-badge review">{reviewLabel(r)}</span>{' '}
                {r.url ? <a href={r.url} target="_blank" rel="noopener">{r.head}</a> : <code>{r.head}</code>}
                {' → '}<code>{r.base}</code>{' '}
                <span className="hint" title={r.mergeBase + '..' + r.headSha}>
                    {short(r.mergeBase)}..{r.kind === 'local' ? (r.dirty ? 'working tree' : short(r.headSha)) : short(r.headSha)}
                </span>
            </p>
            <p className={'status review-state' + (state?.state === 'stale' ? ' err' : '') + (rerun ? ' busy' : '')} id="review-state" aria-live="polite">
                {rerun ? rerun.status || 'Re-running review…'
                    : !state ? 'Checking whether the code changed…'
                    : state.state === 'current' ? 'Up to date with ' + (r.kind === 'pr' ? 'the pull request' : r.kind === 'local' ? 'your checkout' : r.head) + (state.prState && state.prState !== 'open' ? ' (' + state.prState + ')' : '') + '.'
                    : state.state === 'stale' ? 'Out of date: ' + (state.reason || 'the code changed.')
                    : 'Couldn\'t check: ' + (state.reason || 'unknown.')}
            </p>
            <div className="trace-prompt-actions">
                <button className="btn sm" id="review-rerun" type="button" disabled={!!rerun || !vm.repo.aiAvailable || !trace._doc}
                    onClick={() => vm.rerunReview(trace)}>{rerun ? 'Re-running…' : 'Re-run review'}</button>
                {rerun && <button className="btn sm" type="button" onClick={() => vm.stopJob(rerun)}>Stop</button>}
            </div>
        </div>
    );
});
/** A review's notes (map changes, risks, questions) and its changed files by card. */
const ReviewSections = observer(function ReviewSections({ vm, trace }: TraceViewProps & { trace: Trace }) {
    const r = trace.review;
    if (!r) return null;
    const groups = vm.reviewFileGroups(trace);
    const notes = !!(trace.proposal?.rationale || r.risks.length || r.questions.length || r.skipped.length);
    return <>
        {notes && (
            <SettingsSection id="trace-review" title="Review notes" open={vm.sections.review}
                onToggle={(open) => vm.setSection('review', open)}>
                <div className="proposal-summary">
                    {trace.proposal?.rationale && <p>{trace.proposal.rationale}</p>}
                    {r.risks.length > 0 && <div><h4>Worth a careful look</h4><ul>{r.risks.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}
                    {r.questions.length > 0 && <div><h4>Questions for the author</h4><ul>{r.questions.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}
                    {r.skipped.length > 0 && <p className="hint">Diffs too large to send in full: {r.skipped.join(', ')}.</p>}
                </div>
            </SettingsSection>
        )}
        {r.files.length > 0 && (
            <SettingsSection id="trace-files" title="Changed files" count={r.files.length} open={vm.sections.files}
                onToggle={(open) => vm.setSection('files', open)}>
                <DisclosureList className="review-files">
                    {groups.map((g) => {
                        const refs = g.files.map((f) => vm.fileReference(trace, f));
                        return (
                            <Disclosure key={g.id || '-'} id={'review-files-' + (g.id || 'other').replace(/[^\w-]/g, '-')}
                                title={<>{g.status && <span className={'proposal-badge ' + g.status}>{CHANGE_LABELS[g.status]}</span>} {g.title}</>}
                                count={g.files.length} open={vm.isFileGroupOpen(g.id)} onToggle={(open) => vm.setFileGroup(g.id, open)}>
                                <ul className="review-file-list">
                                    {g.files.map((f, i) => (
                                        <li key={f.path}>
                                            <CodeReference reference={refs[i]} repo={vm.repo} list={refs} index={i} />
                                            <span className="review-file-meta">
                                                <span className={'review-file-status s-' + f.status}>{FILE_STATUS[f.status] || f.status}</span>
                                                {' '}<span className="da">+{f.additions}</span> <span className="dd">−{f.deletions}</span>
                                                {f.note && <> · {f.note}</>}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </Disclosure>
                        );
                    })}
                </DisclosureList>
            </SettingsSection>
        )}
    </>;
});
const FILE_STATUS: Record<string, string> = { A: 'added', M: 'changed', D: 'deleted', R: 'renamed', C: 'copied', T: 'type changed' };
export const TraceWalkthrough = observer(function TraceWalkthrough({ vm }: TraceViewProps) {
    const t = vm.selected;
    if (!t) return null;
    return (
        <div className="tb">
            {(t.summary || t.gaps) && (
                <SettingsSection id="trace-summary" title="Summary" open={vm.sections.summary}
                    onToggle={(open) => vm.setSection('summary', open)}>
                    {t.summary && <p className="rs">{t.summary}</p>}
                    {t.gaps && <p className="gaps">Not shown clearly: {t.gaps}</p>}
                </SettingsSection>
            )}
            {t.intent === 'review' && <ReviewSections vm={vm} trace={t} />}
            {t.intent === 'proposal' && t.proposal && (
                <SettingsSection id="trace-proposal" title="Proposed change" open={vm.sections.proposal}
                    onToggle={(open) => vm.setSection('proposal', open)}>
                <div className="proposal-summary">
                    <p>{t.proposal.rationale}</p>
                    {(['assumptions', 'questions'] as const).map(
                        (k) =>
                            t.proposal![k].length > 0 && (
                                <div key={k}>
                                    <h4>
                                        {k === 'assumptions' ? 'Assumptions' : 'Open questions'}
                                    </h4>
                                    <ul>
                                        {t.proposal![k].map((s, i) => (
                                            <li key={i}>{s}</li>
                                        ))}
                                    </ul>
                                </div>
                            )
                    )}
                </div>
                </SettingsSection>
            )}
            {vm.workspace === 'architecture' && vm.unlinkedRepos(t).length > 0 && (
                <p className="hint" id="trace-unlinked">
                    Some steps are in {vm.unlinkedRepos(t).join(', ')}, which is no longer linked. Link it again in Settings → Linked repos to see them on the map.
                </p>
            )}
            {vm.workspace === 'architecture' && (
                <SettingsSection id="trace-steps" title="Trace steps" count={t.steps.length} open={vm.sections.steps}
                    onToggle={(open) => vm.setSection('steps', open)}>
                <ol className="steps">
                    {t.steps.map((step, i) => {
                        const change = t.proposal?.nodes.find((n) => n.id === step.id);
                        const title = vm.stepTitle(t, step.id);
                        return (
                            <li key={step.id}>
                                <button type="button" onClick={() => vm.reveal(step.id)}>
                                    <StepNumber n={i + 1} className="n" />
                                    <b>
                                        {change?.status && (
                                            <span className={'proposal-badge ' + change.status}>{CHANGE_LABELS[change.status]}</span>
                                        )}
                                        {title}
                                    </b>
                                    <span>{step.note}</span>
                                </button>
                                <div className="refs">
                                    {t.refs
                                        .filter((r) => r.step === step.id)
                                        .map((reference, j, stepRefs) => (
                                            <CodeReference
                                                key={j}
                                                reference={reference}
                                                repo={vm.repo}
                                                list={stepRefs}
                                                index={j}
                                            />
                                        ))}
                                </div>
                            </li>
                        );
                    })}
                </ol>
                </SettingsSection>
            )}
            {t.refs.length > 0 && (
                <div className="codestat">
                    <span className="status">
                        {t.refs.length} code reference{t.refs.length === 1 ? '' : 's'} · {t.review && t.review.kind !== 'local'
                            ? 'read at commit ' + t.review.headSha.slice(0, 7) : 'read from your checkout'}
                    </span>
                </div>
            )}
            {t.used?.label && (
                <div className="codestat">
                    <span className="status">{t.review ? 'Reviewed' : 'Traced'} with {t.used.label}</span>
                </div>
            )}
            <TraceActions key={t._doc || t.title} vm={vm} trace={t} />
        </div>
    );
});
export const SelectedTraceSidebar = observer(function SelectedTraceSidebar({ vm }: TraceViewProps) {
    const code = useRef<HTMLTextAreaElement>(null);
    const section = useRef<HTMLElement>(null);
    const active = !!vm.selected;
    const inferred = vm.flowInferred;
    useEffect(() => {
        if (active) {
            const scroller = section.current?.closest('.side-in');
            if (scroller) scroller.scrollTop = 0;
            document.getElementById('trace-back')?.focus({ preventScroll: true });
        }
    }, [active]);
    useEffect(() => {
        if (vm.code) {
            code.current?.focus();
            code.current?.select();
        }
    }, [vm.code]);
    return (
        <section ref={section} id="sidebar-trace" hidden={!vm.selected} aria-label="Selected trace">
            <h2 id="trace-title">{vm.selected?.title}</h2>
            {vm.editing ? <TraceComposer vm={vm} inline /> : <>
                <p id="trace-prompt">{vm.selected?.prompt || 'No prompt saved.'}</p>
                {vm.selected?.review && <ReviewHeader vm={vm} trace={vm.selected} />}
                {vm.selected && <TracePromptActions key={vm.selected._doc || vm.selected.title} vm={vm} trace={vm.selected} />}
                {vm.selected?.intent === 'proposal' && (
                    <button className={'btn primary trace-plan-btn' + (vm.planBusy ? ' busy' : '')} id="trace-plan" type="button"
                        aria-busy={vm.planBusy}
                        onClick={() => vm.selected && vm.openPlan(vm.selected)}>
                        {vm.planBusy
                            ? vm.selected.plan ? 'Regenerating implementation plan…' : 'Creating implementation plan…'
                            : vm.selected.plan ? 'View implementation plan' : 'Create implementation plan'}
                    </button>
                )}
            </>}
            <div hidden={!!vm.editing}>
            <hr />
            <textarea
                id="codebox"
                ref={code}
                readOnly
                hidden={!vm.code}
                value={vm.code}
                aria-label="Trace code"
            />
            <p
                id="trace-status"
                className={'status' + (vm.error ? ' err' : '') + (vm.busy ? ' busy' : '')}
                aria-live="polite"
            >
                {vm.status}
            </p>
            <section
                id="trace-flow-details"
                hidden={vm.workspace !== 'flowchart'}
                aria-label="Flowchart notes"
            >
                <p id="trace-flow-empty" className="hint" hidden={!vm.selected?.pendingFlow}>
                    The supporting walkthrough was kept. Draw the flowchart to complete this output.
                </p>
                {inferred > 0 && (
                    <p id="trace-flow-inferred" className="fwarn">
                        {inferred} part{inferred === 1 ? ' is' : 's are'} inferred. Check them before
                        relying on this chart.
                    </p>
                )}
            </section>
            <div id="trace-walkthrough">
                <TraceWalkthrough vm={vm} />
            </div>
            </div>
        </section>
    );
});
export const TraceBackButton = observer(function TraceBackButton({ vm }: TraceViewProps) {
    return (
        <button
            className="btn"
            id="trace-back"
            type="button"
            hidden={!vm.selected || !!vm.editing}
            onClick={() => {
                vm.clear();
                document.getElementById('new-trace')?.focus();
            }}
        >
            Back to all traces
        </button>
    );
});

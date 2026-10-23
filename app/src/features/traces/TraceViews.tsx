import { useEffect, useRef, useState, type ReactNode } from 'react';
import { observer } from 'mobx-react-lite';
import { CodeReference } from '../../shared/ui/CodeReference';
import type { TraceViewModel } from './TraceViewModel';
import type { Trace, Workspace } from '../../models/types';
export interface TraceViewProps {
    vm: TraceViewModel;
}
export interface TraceHomeProps extends TraceViewProps {
    repositorySummary?: ReactNode;
    onRefreshAgents?: () => void;
}
export const TraceComposer = observer(function TraceComposer({
    vm,
    onRefreshAgents,
}: TraceHomeProps) {
    const prompt = useRef<HTMLTextAreaElement>(null);
    useEffect(() => {
        if (vm.composerOpen) prompt.current?.focus();
    }, [vm.composerOpen]);
    return (
        <section id="composer" hidden={!vm.composerOpen}>
            <h2>Ask about this codebase</h2>
            <p className="hint" id="trace-hint">
                Ask how a process works or where a new feature would fit. {vm.deps.getPickLabel()}{' '}
                reads the map and local code to explain and illustrate the answer.
            </p>
            <div className="noai" id="noai" hidden={vm.repo.aiAvailable}>
                <b>Tracing is off on this machine.</b>{' '}
                <span id="noai-why">{vm.repo.bootstrap?.ai.reason}</span> Run{' '}
                <code>repo-map doctor</code> to see your options, or set one up with the package’s
                SETUP.md. You can still open a trace a teammate shared: paste its code under{' '}
                <a
                    href="#importbox"
                    id="noai-import"
                    onClick={(e) => {
                        e.preventDefault();
                        const box = document.getElementById('importbox');
                        const details = box?.closest('details');
                        if (details) details.open = true;
                        box?.focus();
                    }}
                >
                    {' '}
                    Import a trace code
                </a>
                .
            </div>
            <textarea
                ref={prompt}
                id="prompt"
                disabled={!vm.repo.aiAvailable}
                aria-label="Question about the codebase"
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
            <div className="trace-outputs">
                <fieldset className="output-options" disabled={!vm.repo.aiAvailable}>
                    <legend>Outputs</legend>
                    <label className="opt">
                        <input
                            type="checkbox"
                            id="witharchitecture"
                            checked={vm.architecture}
                            onChange={(e) => vm.setOutput('architecture', e.target.checked)}
                        />{' '}
                        Code architecture
                    </label>
                    <label className="opt">
                        <input
                            type="checkbox"
                            id="withflow"
                            checked={vm.flowchart}
                            onChange={(e) => vm.setOutput('flowchart', e.target.checked)}
                        />{' '}
                        Flowchart
                    </label>
                    <p className="hint">
                        Code architecture highlights the process on the repository map. Flowchart
                        shows its decisions and outcomes.
                    </p>
                </fieldset>
            </div>
            <div className="trace-actions">
                <button
                    className="btn primary"
                    id="run"
                    type="button"
                    disabled={vm.busy || !vm.repo.aiAvailable}
                    onClick={() => void vm.runTrace()}
                >
                    Create trace
                </button>
                <button
                    className="iconbtn"
                    id="pick-refresh"
                    type="button"
                    title="Look for AI tools and models again"
                    aria-label="Look for AI tools and models again"
                    onClick={onRefreshAgents}
                >
                    <svg viewBox="0 0 16 16">
                        <path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5v3h-3" />
                    </svg>
                </button>
                <span
                    className={'status' + (vm.busy ? ' busy' : '') + (vm.error ? ' err' : '')}
                    id="status"
                    aria-live="polite"
                >
                    {vm.status}
                </span>
                <button className="btn" id="stop" type="button" hidden={!vm.busy} onClick={vm.stop}>
                    Stop
                </button>
            </div>
        </section>
    );
});
export const TraceLibrary = observer(function TraceLibrary({ vm }: TraceViewProps) {
    return (
        <section>
            <h2>
                Saved traces{' '}
                <span className="gc" id="savedcount">
                    {vm.rows.length || ''}
                </span>
            </h2>
            <p className="hint" id="store-note">
                {vm.storeNote}
            </p>
            <ul className="trace-list" id="trace-list">
                {vm.rows.map((trace, i) => (
                    <li className="ti trace-card" key={trace.key || trace._doc || i}>
                        <button
                            className="trace-open"
                            type="button"
                            onClick={() =>
                                void vm.openSavedOutput(
                                    trace,
                                    trace.outputs?.architecture !== false
                                        ? 'architecture'
                                        : 'flowchart'
                                )
                            }
                        >
                            <span className="trace-card-title">{trace.title}</span>
                            <span className="trace-prompt">
                                {trace.prompt || 'No prompt saved.'}
                            </span>
                            {trace === vm.temp && (
                                <span className="trace-save-note">Not saved</span>
                            )}
                        </button>
                    </li>
                ))}
            </ul>
            <p className="empty" id="saved-empty" hidden={vm.rows.length > 0}>
                No saved traces yet. Create a trace, or import one from a teammate.
            </p>
            <details className="imp">
                <summary>Import a trace code</summary>
                <textarea
                    id="importbox"
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
        </section>
    );
});
export const TraceHome = observer(function TraceHome({
    vm,
    repositorySummary,
    onRefreshAgents,
}: TraceHomeProps) {
    return (
        <div id="sidebar-home" hidden={!!vm.selected}>
            {repositorySummary ?? (
                <section className="repo-summary" aria-label="Repository">
                    <h1 id="map-name">{vm.repo.bootstrap?.config.name || 'Repo Map'}</h1>
                    <p className="sub">
                        <code id="repo-name">{vm.repo.bootstrap?.config.repo}</code>
                        <span id="stat">
                            {vm.repo.map.nodes.length} components · {vm.repo.map.edges.length}{' '}
                            connections
                        </span>
                        <span id="repoinfo">{vm.repo.bootstrap?.repo.branch}</span>
                    </p>
                </section>
            )}
            <button
                className="btn primary"
                id="new-trace"
                type="button"
                aria-expanded={vm.composerOpen}
                aria-controls="composer"
                onClick={vm.toggleComposer}
            >
                New trace
            </button>
            <div className="pane" id="pane-traces">
                <TraceComposer vm={vm} onRefreshAgents={onRefreshAgents} />
                <TraceLibrary vm={vm} />
            </div>
        </div>
    );
});
function TraceActions({ vm, trace }: TraceViewProps & { trace: Trace }) {
    const [armed, setArmed] = useState(false);
    useEffect(() => {
        if (!armed) return;
        const timer = setTimeout(() => setArmed(false), 3000);
        return () => clearTimeout(timer);
    }, [armed]);
    return (
        <div className="sva">
            <button
                className="linkbtn"
                data-a="copy"
                type="button"
                onClick={() => void vm.copyCode(trace)}
            >
                Copy trace code
            </button>
            {trace._doc && (
                <button
                    className="linkbtn danger"
                    data-a="del"
                    type="button"
                    onClick={() => {
                        if (armed) void vm.removeTrace(trace);
                        else setArmed(true);
                    }}
                >
                    {armed ? 'Delete trace and both outputs?' : 'Delete'}
                </button>
            )}
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
}
export const TraceWalkthrough = observer(function TraceWalkthrough({ vm }: TraceViewProps) {
    const t = vm.selected;
    if (!t) return null;
    return (
        <div className="tb">
            {t.summary && <p className="rs">{t.summary}</p>}
            {t.intent === 'proposal' && t.proposal && (
                <section className="proposal-summary">
                    <h3>Proposed change</h3>
                    <p className="proposal-legend">
                        New: dashed border · Modified: bold border · Removed: dotted border and
                        struck-through label. Proposed changes are not implemented code.
                    </p>
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
                    <button className="btn" type="button" onClick={() => vm.openPlan(t)}>
                        Implementation plan
                    </button>
                </section>
            )}
            {vm.workspace !== 'flowchart' && (
                <ol className="steps">
                    {t.steps.map((step, i) => {
                        const change = t.proposal?.nodes.find((n) => n.id === step.id);
                        const title =
                            vm.repo.map.nodes.find((n) => n.id === step.id)?.title ||
                            change?.title ||
                            step.id;
                        return (
                            <li key={step.id}>
                                <button type="button" onClick={() => vm.reveal(step.id)}>
                                    <i className="n">{i + 1}</i>
                                    <b>
                                        {title}
                                        {change?.status &&
                                            ` [${{ new: 'New', modified: 'Modified', removed: 'Removed' }[change.status]}]`}
                                    </b>
                                    <span>{step.note}</span>
                                </button>
                                <div className="refs">
                                    {t.refs
                                        .filter((r) => r.step === step.id)
                                        .map((reference, j) => (
                                            <CodeReference
                                                key={j}
                                                reference={reference}
                                                repo={vm.repo}
                                            />
                                        ))}
                                </div>
                            </li>
                        );
                    })}
                </ol>
            )}
            {t.refs.length > 0 && (
                <div className="codestat">
                    <span className="status">
                        {t.refs.length} code reference{t.refs.length === 1 ? '' : 's'} · read from
                        your checkout
                    </span>
                </div>
            )}
            {t.used?.label && (
                <div className="codestat">
                    <span className="status">Traced with {t.used.label}</span>
                </div>
            )}
            {t.gaps && <p className="gaps">Not shown clearly: {t.gaps}</p>}
            <TraceActions key={t._doc || t.title} vm={vm} trace={t} />
        </div>
    );
});
export interface SelectedTraceProps extends TraceViewProps {
    flowDetails?: ReactNode;
}
export const SelectedTraceSidebar = observer(function SelectedTraceSidebar({
    vm,
    flowDetails,
}: SelectedTraceProps) {
    const code = useRef<HTMLTextAreaElement>(null);
    const section = useRef<HTMLElement>(null);
    const active = !!vm.selected;
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
            <p id="trace-prompt">{vm.selected?.prompt || 'No prompt saved.'}</p>
            <hr />
            <div className="trace-tabs" role="tablist" aria-label="Trace output">
                {(['architecture', 'flowchart'] as Workspace[]).map((output) => (
                    <button
                        className="btn"
                        id={'trace-' + output}
                        key={output}
                        type="button"
                        role="tab"
                        aria-controls={
                            output === 'architecture' ? 'architecture-workspace' : 'flowdlg'
                        }
                        aria-selected={vm.workspace === output}
                        tabIndex={vm.workspace === output ? 0 : -1}
                        disabled={
                            output === 'flowchart' &&
                            !vm.selected?.flow &&
                            !vm.selected?.pendingFlow &&
                            !vm.repo.aiAvailable
                        }
                        onClick={() => void vm.openOutput(output)}
                        onKeyDown={(e) => {
                            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
                            e.preventDefault();
                            const target =
                                e.currentTarget.parentElement?.querySelector<HTMLButtonElement>(
                                    '#trace-' +
                                        (e.key === 'Home'
                                            ? 'architecture'
                                            : e.key === 'End'
                                              ? 'flowchart'
                                              : output === 'architecture'
                                                ? 'flowchart'
                                                : 'architecture')
                                );
                            if (target && !target.disabled) {
                                target.focus();
                                target.click();
                            }
                        }}
                    >
                        {output === 'architecture' ? 'Architecture' : 'Flowchart'}
                    </button>
                ))}
            </div>
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
                aria-label="Flowchart details"
            >
                <p id="trace-flow-empty" className="hint" hidden={!vm.selected?.pendingFlow}>
                    The supporting walkthrough was kept. Draw the flowchart to complete this output.
                </p>
                {flowDetails}
            </section>
            <div id="trace-walkthrough">
                <TraceWalkthrough vm={vm} />
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
            hidden={!vm.selected}
            onClick={() => {
                vm.clear();
                document.getElementById('new-trace')?.focus();
            }}
        >
            Back to all traces
        </button>
    );
});

import { useRef, type ComponentType } from 'react';
import { observer } from 'mobx-react-lite';
import type { CodeRef } from '../../models/types';
import type { RepositoryModel } from '../../models/RepositoryModel';
import type { FlowchartViewModel, ConnectionTab } from './FlowchartViewModel';
import { CHANGE_LABELS } from '../../../../lib/proposal.mjs';
import { FC_CSS, UI_CSS } from './styles';
import { DiagramSvg } from '../../shared/ui/DiagramSvg';
import { DiagramToolbar } from '../../shared/ui/DiagramToolbar';
import { DirectionTabs, type DirectionTab } from '../../shared/ui/DirectionTabs';

export interface FlowchartDetailsProps {
    vm: FlowchartViewModel;
    CodeReference: ComponentType<{
        reference: CodeRef;
        repo: RepositoryModel;
        documentation?: boolean;
    }>;
}
const FLOW_KIND: Record<string, string> = {
    start: 'Start',
    end: 'Outcome',
    action: 'Person does',
    process: 'System does',
    decision: 'Decision',
    error: 'Failure',
};
/** Edges arriving at (From) and leaving (To) the selected node. Clicking one moves the selection. */
const FlowConnections = observer(function FlowConnections({ vm, id }: { vm: FlowchartViewModel; id: string }) {
    const conns = vm.connections;
    if (!conns.from.length && !conns.to.length) {
        return <section className="flow-conn"><h4>Connections</h4><p className="hint">No connections.</p></section>;
    }
    const tabs: DirectionTab<ConnectionTab>[] = [
        { id: 'from', label: 'From', count: conns.from.length },
        { id: 'to', label: 'To', count: conns.to.length },
    ];
    return (
        <section className="flow-conn" aria-label="Connections">
            <h4>Connections</h4>
            <DirectionTabs idPrefix={'fl-conn-' + id} label="Connection direction" tabs={tabs}
                active={vm.connectionTab} onChange={vm.setConnectionTab}>
                {(active) => (
                    <ul>
                        {conns[active].map(({ edge, index, other }) => (
                            <li key={active + index}>
                                <button className="btn sm" type="button" data-go={other}
                                    onClick={() => { vm.hoverConnection(null); vm.select(other); }}
                                    onMouseEnter={() => vm.hoverConnection(index, other)} onMouseLeave={() => vm.hoverConnection(null)}
                                    onFocus={() => vm.hoverConnection(index, other)} onBlur={() => vm.hoverConnection(null)}>
                                    {vm.nodeLabel(other)}
                                    {edge.status && <span className={'proposal-badge ' + edge.status}>{CHANGE_LABELS[edge.status]}</span>}
                                </button>
                                {(edge.label || edge.inferred) && <span className="hint">
                                    {[edge.label, edge.inferred && 'inferred'].filter(Boolean).join(' · ')}
                                </span>}
                            </li>
                        ))}
                    </ul>
                )}
            </DirectionTabs>
        </section>
    );
});

/** The right-hand panel for the selected node. Hidden while nothing is selected. */
export const FlowchartDetails = observer(function FlowchartDetails({
    vm,
    CodeReference,
}: FlowchartDetailsProps) {
    const node = vm.selected;
    if (!node) return null;
    const change = vm.selectedChange;
    const close = (event: { currentTarget: HTMLElement }) => {
        const id = node.id;
        const main = event.currentTarget.closest('.fmain');
        vm.close();
        // Return keyboard focus to the node the panel described.
        main?.querySelector<SVGElement>(`.fn[data-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
    };
    return (
        <aside className="fside" id="fl-side" aria-label="Step details" aria-live="polite"
            onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); close(event); } }}>
            <div className="fside-head">
                <p className="ft">{FLOW_KIND[node.type] || 'Step'}</p>
                <button className="btn sm" id="fl-side-close" type="button" onClick={close}>Close</button>
            </div>
            <h3>{node.label}</h3>
            {vm.selectedLane && <p className="ft">Executes in: {vm.selectedLane}</p>}
            {node.detail && <p className="fd">{node.detail}</p>}
            {node.inferred && <p className="fwarn">Inferred. Check this step before relying on it.</p>}
            {change && (
                <section className="flow-change" aria-label="Proposed change">
                    <h4 className={change.status}>{CHANGE_LABELS[change.status]}</h4>
                    {change.rationale && <p>{change.rationale}</p>}
                </section>
            )}
            {vm.references.length > 0 && (
                <div className="refs">
                    {vm.references.map((reference, index) => (
                        <CodeReference
                            key={`${vm.selectedId}:${reference.path}:${reference.start}:${reference.end}:${index}`}
                            documentation={!!reference.kind}
                            reference={reference}
                            repo={vm.repo}
                        />
                    ))}
                </div>
            )}
            <FlowConnections vm={vm} id={node.id} />
        </aside>
    );
});

function FlowchartLegend({ open, proposal }: { open: boolean; proposal: boolean }) {
    return (
        <section className="flegend" id="flowchart-key" aria-label="Diagram key" hidden={!open}>
            <div>
                <span>
                    <svg viewBox="0 0 22 14" aria-hidden="true">
                        <rect className="lg" x="1" y="2" width="20" height="10" rx="5" />
                    </svg>
                    start / end
                </span>
                <span>
                    <svg viewBox="0 0 22 14" aria-hidden="true">
                        <polygon className="lg act" points="5,2 21,2 17,12 1,12" />
                    </svg>
                    person does
                </span>
                <span>
                    <svg viewBox="0 0 22 14" aria-hidden="true">
                        <rect className="lg" x="1" y="2" width="20" height="10" rx="2" />
                    </svg>
                    system does
                </span>
                <span>
                    <svg viewBox="0 0 22 14" aria-hidden="true">
                        <polygon className="lg dec" points="11,0 22,7 11,14 0,7" />
                    </svg>
                    decision
                </span>
                <span>
                    <svg viewBox="0 0 22 14" aria-hidden="true">
                        <rect className="lg err" x="1" y="2" width="20" height="10" rx="2" />
                    </svg>
                    failure
                </span>
                <span>
                    <svg viewBox="0 0 22 14" aria-hidden="true">
                        <rect className="lg inf" x="1" y="2" width="20" height="10" rx="2" />
                    </svg>
                    inferred
                </span>
            </div>
            <p data-proposal-key className="proposal-legend" hidden={!proposal}>
                Proposed changes: <span className="key-change">New</span>{' '}
                <span className="key-change modified">Modified</span>{' '}
                <span className="key-change removed">Removed</span>
            </p>
        </section>
    );
}
export interface FlowchartWorkspaceProps extends FlowchartDetailsProps {
    onNewTrace?: () => void;
}
export const FlowchartWorkspace = observer(function FlowchartWorkspace({
    vm,
    CodeReference,
    onNewTrace,
}: FlowchartWorkspaceProps) {
    const root = useRef<HTMLElement>(null);
    const hasFlow = !!vm.trace?.flow;
    return (
        <>
            <style>{FC_CSS + UI_CSS}</style>
            {!vm.trace ? (
                <div id="flow-empty" className="flow-empty">
                    <h2>Explore a process as a flowchart</h2>
                    <p>
                        Create a trace with Flowchart selected, or open a saved flowchart from the
                        library.
                    </p>
                    <button className="btn primary" type="button" onClick={onNewTrace}>
                        New trace
                    </button>
                </div>
            ) : (
                <section ref={root} className="fdlg" id="flowdlg" aria-label="Flowchart">
                    <DiagramToolbar prefix="fl" label="Flowchart" available={hasFlow}
                        selectors={vm.hasLanes && <label>
                            Layout{' '}
                            <select aria-label="Flowchart layout" value={vm.compact ? 'compact' : 'lanes'}
                                onChange={event => vm.setCompact(event.target.value === 'compact')}>
                                <option value="lanes">Execution lanes</option>
                                <option value="compact">Compact</option>
                            </select>
                        </label>}
                        diagramKey={{ id: 'flowchart-key', open: vm.keyOpen, toggle: vm.toggleKey }}
                        status={vm.status} busy={vm.busy} error={vm.error} copied={vm.copied}
                        onZoom={vm.zoom} onFit={() => {
                            const canvas = root.current?.querySelector('#fl-canvas');
                            if (canvas) vm.fit(canvas.clientWidth, canvas.clientHeight);
                        }}
                        onCopy={vm.copyMermaid} onDownload={vm.downloadSvg} onStop={() => vm.stop()}
                        generation={{ label: hasFlow ? 'Redraw' : 'Draw flowchart',
                            title: 'Ask the AI tool to draw this flowchart again', hidden: !vm.repo.aiAvailable,
                            run: () => { if (vm.trace) void vm.generate(vm.trace); } }}
                    />
                    <FlowchartLegend open={vm.keyOpen} proposal={vm.trace.intent === 'proposal'} />
                    {!hasFlow && (
                        <p id="flow-missing" className="hint">
                            The supporting walkthrough was kept. Draw the flowchart to complete this
                            output.
                        </p>
                    )}
                    <div
                        className={'fmain' + (vm.selected ? '' : ' details-closed')}
                        hidden={!hasFlow}
                    >
                        <DiagramSvg vm={vm} initialZoom={1.2 ** 2} />
                        <FlowchartDetails vm={vm} CodeReference={CodeReference} />
                    </div>
                </section>
            )}
        </>
    );
});

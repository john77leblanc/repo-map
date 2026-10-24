import { useRef, type ComponentType, type ReactNode } from 'react';
import { observer } from 'mobx-react-lite';
import type { CodeRef } from '../../models/types';
import type { RepositoryModel } from '../../models/RepositoryModel';
import type { FlowchartViewModel } from './FlowchartViewModel';
import { CHANGE_LABELS } from '../../../../lib/proposal.mjs';
import { FC_CSS, UI_CSS } from './styles';
import { DiagramSvg } from '../../shared/ui/DiagramSvg';
import { DiagramToolbar } from '../../shared/ui/DiagramToolbar';

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
export const FlowchartDetails = observer(function FlowchartDetails({
    vm,
    CodeReference,
}: FlowchartDetailsProps) {
    const node = vm.selected;
    return (
        <aside className="fside" id="fl-side" aria-label="Flowchart details" aria-live="polite">
            {!node ? (
                vm.inferred > 0 && (
                    <p className="fwarn" style={{ marginTop: 10 }}>
                        {vm.inferred} part{vm.inferred === 1 ? ' is' : 's are'} inferred. Check them
                        before relying on this chart.
                    </p>
                )
            ) : (
                <>
                    <p className="ft">
                        {FLOW_KIND[node.type] || 'Step'}
                        {node.inferred ? ' · inferred' : ''}
                        {node.status ? ' · ' + CHANGE_LABELS[node.status] : ''}
                    </p>
                    <h3>{node.label}</h3>
                    {vm.selectedLane && <p className="ft">Executes in: {vm.selectedLane}</p>}
                    {node.detail && <p className="fd">{node.detail}</p>}
                    {node.type === 'decision' && (
                        <p className="fd">
                            {vm.trace?.flow?.edges
                                .filter((edge) => edge.from === node.id)
                                .map((edge, index) => (
                                    <span key={index}>
                                        <b>{edge.label || 'then'}</b> {'\u2192'}{' '}
                                        {vm.trace?.flow?.nodes.find((n) => n.id === edge.to)
                                            ?.label || ''}
                                        <br />
                                    </span>
                                ))}
                        </p>
                    )}
                    {!!node.step && (
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
                </>
            )}
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
    details?: ReactNode;
    onNewTrace?: () => void;
}
export const FlowchartWorkspace = observer(function FlowchartWorkspace({
    vm,
    CodeReference,
    details,
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
                        className={'fmain' + (details === null ? ' details-closed' : '')}
                        hidden={!hasFlow}
                    >
                        <DiagramSvg vm={vm} initialZoom={1.2 ** 2} />
                        {details === undefined ? (
                            <FlowchartDetails vm={vm} CodeReference={CodeReference} />
                        ) : (
                            details
                        )}
                    </div>
                </section>
            )}
        </>
    );
});

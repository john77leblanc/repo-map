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
import { Disclosure, DisclosureList } from '../../shared/ui/Disclosure';
import { SidePanel } from '../../shared/ui/SidePanel';
import { FlowShape } from './FlowShape';
import { ConnectionRow } from './ConnectionRow';

export interface FlowchartDetailsProps {
    vm: FlowchartViewModel;
    CodeReference: ComponentType<{
        reference: CodeRef;
        repo: RepositoryModel;
        documentation?: boolean;
        list?: CodeRef[];
        index?: number;
    }>;
}
const FLOW_KIND: Record<string, string> = {
    start: 'Start',
    end: 'Outcome',
    action: 'Person does',
    process: 'System does',
    decision: 'Decision',
    error: 'Failure',
    collapsed: 'Collapsed group',
};

/** Folding controls for the toolbar: select mode and Expand all. The selection itself is in the side panel. */
const FlowCollapseControls = observer(function FlowCollapseControls({ vm }: { vm: FlowchartViewModel }) {
    return (
        <>
            <button className="btn" id="fl-select-mode" type="button" aria-pressed={vm.selecting} onClick={vm.toggleSelecting}
                title="Pick steps to collapse into one box. Shift-click a step also adds it.">
                Select steps
            </button>
            {vm.collapsedCount > 0 && (
                <button className="btn" id="fl-expand-all" type="button" onClick={vm.expandAll}>Expand all</button>
            )}
        </>
    );
});

/** Side-panel body for a collapsed box: its name, hidden steps and Expand. */
const CollapsedDetails = observer(function CollapsedDetails({ vm, id, label }: { vm: FlowchartViewModel; id: string; label: string }) {
    // The title is in the panel header; a renameable group adds its name field.
    const members = vm.members(id);
    // The clicked button goes away with the box, so keyboard focus moves to the selected step once it is drawn.
    const expand = (event: { currentTarget: HTMLElement }, step: string | null = null) => {
        const main = event.currentTarget.closest('.fmain');
        const selected = vm.expand(id, step);
        if (selected) requestAnimationFrame(() =>
            main?.querySelector<SVGElement>(`.fn[data-id="${CSS.escape(selected)}"]`)?.focus());
    };
    return (
        <>
            {vm.canRename(id) && (
                <input className="fside-input" type="text" aria-label="Group name" value={vm.groupLabel(id)}
                    placeholder={label} maxLength={80} onChange={(event) => vm.renameGroup(id, event.target.value)} />
            )}
            <h4>{members.length} hidden steps</h4>
            <ol className="flow-members">
                {members.map((m) => (
                    <li key={m.id}>
                        <button className="btn sm" type="button" data-member={m.id}
                            onClick={(event) => expand(event, m.id)}>{m.label}</button>
                    </li>
                ))}
            </ol>
            <button className="btn primary sm" id="fl-expand" type="button" onClick={(event) => expand(event)}>Expand</button>
        </>
    );
});
/** The side panel while steps are selected: what's in the selection, Collapse and Clear. */
const SelectionDetails = observer(function SelectionDetails({ vm }: { vm: FlowchartViewModel }) {
    const nodes = vm.markedNodes;
    return (
        <SidePanel id="fl-side" aria-label="Selected steps" aria-live="polite" closeId="fl-side-close" onClose={vm.clearMarks}
            title={`${nodes.length} step${nodes.length === 1 ? '' : 's'} selected`}>
            <ol className="flow-members" id="fl-selection">
                {nodes.map((n) => (
                    <li key={n.id} data-marked={n.id}>
                        <div className="flow-member-row">
                            <span>{n.label}</span>
                            <button className="btn sm unmark" type="button" data-unmark={n.id} aria-label={'Remove ' + n.label}
                                onClick={() => vm.mark(n.id)}>Remove</button>
                        </div>
                    </li>
                ))}
            </ol>
            {nodes.length < 2 && <p className="hint">Pick at least two steps.</p>}
            <div className="flow-select-actions">
                <button className="btn sm primary" id="fl-collapse-sel" type="button" disabled={nodes.length < 2}
                    onClick={() => vm.collapseMarked()}>Collapse</button>
                <button className="btn sm" id="fl-clear-sel" type="button" onClick={vm.clearMarks}>Clear</button>
            </div>
        </SidePanel>
    );
});

/**
 * A box's closer look: the AI's explanation and the smaller steps inside it, with
 * Expand / Collapse in chart. Steps inside a closer look show it too; its mini drawing selects them.
 */
/** A closer-look job's progress and Stop, beside its button. */
const CloserStatus = observer(function CloserStatus({ vm, box }: { vm: FlowchartViewModel; box: string }) {
    const running = vm.busy && vm.expandingId === box;
    const status = vm.closerStatus(box);
    return (
        <>
            {running && <button className="btn sm" id="fl-closer-stop" type="button" onClick={() => vm.stop()}>Stop</button>}
            <span className={'status' + (running ? ' busy' : vm.error ? ' err' : '')} id="fl-closer-status"
                role="status" aria-live="polite">{status}</span>
        </>
    );
});

const CloserLook = observer(function CloserLook({ vm, id }: { vm: FlowchartViewModel; id: string }) {
    const found = vm.expansionFor(id);
    if (!found) {
        if (!vm.canExpand(id) || !vm.repo.aiAvailable) return null;
        const running = vm.expandingId === id;
        return (
            <>
                <hr className="fside-rule" />
                <section className="flow-closer" id="fl-closer" aria-label="Closer look">
                    <h4>Closer look</h4>
                    <p className="hint">Ask the AI tool to split this step into smaller steps and explain it, from the code.</p>
                    <div className="flow-select-actions">
                        <button className="btn sm primary" id="fl-look-closer" type="button" disabled={vm.busy}
                            onClick={() => void vm.lookCloser(id)}>{running ? 'Looking closer…' : 'Look closer'}</button>
                        <CloserStatus vm={vm} box={id} />
                    </div>
                </section>
            </>
        );
    }
    const { expansion } = found;
    const box = found.id;
    const shown = vm.isShown(box);
    // Mini drawing boxes open that step in the chart (delegated: the drawing is markup).
    const pick = (event: { target: EventTarget }) => {
        const step = (event.target as Element).closest?.('.fn')?.getAttribute('data-id');
        if (step) vm.openCloserStep(box, step);
    };
    return (
        <>
        <hr className="fside-rule" />
        <section className="flow-closer has-look" id="fl-closer" aria-label="Closer look">
            <div className="flow-closer-head">
                {/* On the box itself the panel title already names it. */}
                {id === box ? <h4>Closer look</h4>
                    : <h4>Closer look inside <span className="flow-closer-box" title={found.label}>{found.label}</span></h4>}
                <span className="flow-closer-count">({expansion.nodes.length} step{expansion.nodes.length === 1 ? '' : 's'})</span>
            </div>
            <div className="flow-select-actions">
                {expansion.inline && (
                    <button className="btn sm primary" id="fl-closer-toggle" type="button" onClick={() => vm.setShown(box, !shown)}>
                        {shown ? 'Collapse in chart' : 'Expand in chart'}
                    </button>
                )}
                {vm.repo.aiAvailable && (
                    <button className="btn sm" id="fl-closer-redo" type="button" disabled={vm.busy}
                        onClick={() => void vm.lookCloser(box)}>{vm.expandingId === box ? 'Looking closer…' : 'Look again'}</button>
                )}
                <button className="btn sm" id="fl-closer-remove" type="button" disabled={vm.busy}
                    onClick={() => void vm.removeExpansion(box)}>Delete</button>
                <CloserStatus vm={vm} box={box} />
            </div>
            {expansion.summary && <p className="fd">{expansion.summary}</p>}
            {expansion.inline
                ? <div className="flow-mini" onClick={pick}
                    onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return;
                        event.preventDefault();
                        pick(event);
                    }}
                    dangerouslySetInnerHTML={{ __html: vm.miniSvg(box, vm.selectedId) }} />
                : <div className="flow-mini" aria-hidden="true" dangerouslySetInnerHTML={{ __html: vm.miniSvg(box) }} />}
            {expansion.gaps && <p className="fwarn">Not clear from the code: {expansion.gaps}</p>}
            {!expansion.inline && <p className="hint">Its arrows couldn't be matched to the chart, so it's shown here only.</p>}
            {expansion.used?.label && <p className="hint">By {expansion.used.label}</p>}
        </section>
        </>
    );
});

/** Edges arriving at (From) and leaving (To) the selected node. Clicking one moves the selection. */
const FlowConnections = observer(function FlowConnections({ vm, id }: { vm: FlowchartViewModel; id: string }) {
    const conns = vm.connections;
    if (!conns.from.length && !conns.to.length) {
        return <p className="hint">No connections.</p>;
    }
    const tabs: DirectionTab<ConnectionTab>[] = [
        { id: 'from', label: 'From', count: conns.from.length },
        { id: 'to', label: 'To', count: conns.to.length },
    ];
    return (
        <section className="flow-conn" aria-label="Connections">
            <DirectionTabs idPrefix={'fl-conn-' + id} label="Connection direction" tabs={tabs}
                active={vm.connectionTab} onChange={vm.setConnectionTab}>
                {(active) => (
                    <ul>
                        {conns[active].map(({ edge, index, other }) => {
                            const target = vm.nodeShape(other);
                            return (
                                <li key={active + index}>
                                    <ConnectionRow go={other} title={vm.nodeLabel(other)} shape={target} status={target.status}
                                        arrow={edge} direction={active}
                                        onClick={() => { vm.hoverConnection(null); vm.select(other); }}
                                        onHover={(on) => vm.hoverConnection(on ? index : null, on ? other : null)} />
                                </li>
                            );
                        })}
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
    if (vm.marked.length) return <SelectionDetails vm={vm} />;
    const node = vm.selected;
    if (!node) return null;
    const change = vm.selectedChange;
    // A step drawn inside a shown closer look names the box it's inside.
    const found = node.collapsed ? null : vm.expansionFor(node.id);
    const parent = found && found.id !== node.id ? found : null;
    const close =(event: { currentTarget: HTMLElement }) => {
        const id = node.id;
        const main = event.currentTarget.closest('.fmain');
        vm.close();
        // Return keyboard focus to the node the panel described.
        main?.querySelector<SVGElement>(`.fn[data-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
    };
    return (
        <SidePanel id="fl-side" aria-label="Step details" aria-live="polite" closeId="fl-side-close" onClose={close}
            title={<><FlowShape type={node.type} inside={!!parent} inferred={node.inferred} />{node.label}</>}
            status={change?.status} kind={'Step' + (FLOW_KIND[node.type] ? ' — ' + FLOW_KIND[node.type] : '')}>
            {node.collapsed && <CollapsedDetails vm={vm} id={node.id} label={node.label} />}
            <DisclosureList className={parent ? 'in-closer' : undefined}>
                {(vm.selectedLane || node.detail || node.inferred || change) && (
                    <Disclosure id="fl-about" title="About" open={vm.sections.about}
                        onToggle={(open) => vm.setSection('about', open)}>
                        {vm.selectedLane && <p className="ft">Executes in: {vm.selectedLane}</p>}
                        {node.detail && <p className="fd">{node.detail}</p>}
                        {node.inferred && <p className="fwarn">Inferred. Check this step before relying on it.</p>}
                        {change && (
                            <section className="flow-change" aria-label="Proposed change">
                                <h4 className={change.status}>{CHANGE_LABELS[change.status]}</h4>
                                {change.rationale && <p>{change.rationale}</p>}
                            </section>
                        )}
                    </Disclosure>
                )}
                {vm.references.length > 0 && (
                    <Disclosure id="fl-refs" title="References" count={vm.references.length}
                        open={vm.sections.refs} onToggle={(open) => vm.setSection('refs', open)}>
                        <div className="refs">
                            {vm.references.map((reference, index) => (
                                <CodeReference
                                    key={`${vm.selectedId}:${reference.path}:${reference.start}:${reference.end}:${index}`}
                                    documentation={!!reference.kind}
                                    reference={reference}
                                    repo={vm.repo}
                                    list={vm.references}
                                    index={index}
                                />
                            ))}
                        </div>
                    </Disclosure>
                )}
                <Disclosure id="fl-connections" title="Connections" count={vm.connections.from.length + vm.connections.to.length}
                    open={vm.sections.connections} onToggle={(open) => vm.setSection('connections', open)}>
                    <FlowConnections vm={vm} id={node.id} />
                </Disclosure>
            </DisclosureList>
            {!node.collapsed && <CloserLook vm={vm} id={node.id} />}
        </SidePanel>
    );
});

function FlowchartLegend({ open, proposal }: { open: boolean; proposal: boolean }) {
    return (
        <section className="flegend" id="flowchart-key" aria-label="Diagram key" hidden={!open}>
            <div>
                <span><FlowShape type="start" />start / end</span>
                <span><FlowShape type="action" />person does</span>
                <span><FlowShape type="process" />system does</span>
                <span><FlowShape type="decision" />decision</span>
                <span><FlowShape type="error" />failure</span>
                <span><FlowShape type="process" inferred />inferred</span>
                <span><FlowShape type="collapsed" />collapsed group</span>
                <span>
                    <svg viewBox="0 0 22 14" aria-hidden="true">
                        <rect className="lg" x="1" y="3" width="17" height="10" rx="2" />
                        <circle className="lg-badge" cx="17" cy="4" r="3.6" />
                    </svg>
                    has a closer look
                </span>
                <span>
                    <svg viewBox="0 0 22 14" aria-hidden="true">
                        <rect className="lg-frame" x="0.5" y="0.5" width="21" height="13" rx="3" />
                        <rect className="lg xp" x="4" y="4" width="14" height="7" rx="2" />
                    </svg>
                    inside a closer look
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
export type FlowchartWorkspaceProps = FlowchartDetailsProps;
/** A trace's flowchart. Without a trace the app shows the view switcher's message instead. */
export const FlowchartWorkspace = observer(function FlowchartWorkspace({
    vm,
    CodeReference,
}: FlowchartWorkspaceProps) {
    const root = useRef<HTMLElement>(null);
    const hasFlow = !!vm.trace?.flow;
    return (
        <>
            <style>{FC_CSS + UI_CSS}</style>
            {!vm.trace ? null : (
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
                        tools={hasFlow && <FlowCollapseControls vm={vm} />}
                        diagramKey={{ id: 'flowchart-key', open: vm.keyOpen, toggle: vm.toggleKey }}
                        status={vm.chartStatus} busy={vm.busy} stoppable={!vm.expandingId} error={vm.error} copied={vm.copied}
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
                        className={'fmain' + (vm.panelOpen ? '' : ' details-closed')}
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

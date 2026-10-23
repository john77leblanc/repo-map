import { useLayoutEffect, useRef, type ComponentType, type ReactNode } from 'react';
import { observer } from 'mobx-react-lite';
import type { CodeRef } from '../../models/types';
import type { RepositoryModel } from '../../models/RepositoryModel';
import type { FlowchartViewModel } from './FlowchartViewModel';
import { CHANGE_LABELS } from '../../../../lib/proposal.mjs';
import { FC_CSS, UI_CSS } from './styles';

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

/** React owns the host; only this adapter mutates its generated SVG descendants. */
const FlowchartSvg = observer(function FlowchartSvg({ vm }: { vm: FlowchartViewModel }) {
    const host = useRef<HTMLDivElement>(null);
    const canvas = useRef<HTMLDivElement>(null);
    const svg = vm.svg;
    const layout = vm.layout;
    useLayoutEffect(() => {
        if (!host.current) return;
        host.current.innerHTML = svg;
        host.current
            .querySelector('defs')
            ?.insertAdjacentHTML(
                'beforeend',
                '<marker id="fc-arrow-on" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path class="fa on" d="M0 0.5L7.5 4L0 7.5z"/></marker>'
            );
        if (canvas.current)
            vm.fit(canvas.current.clientWidth, canvas.current.clientHeight, 1.2 ** 2);
    }, [svg, vm]);
    useLayoutEffect(() => {
        const element = host.current?.querySelector('svg');
        if (!element || !layout) return;
        element.setAttribute('width', String(Math.round(layout.width * vm.scale)));
        element.setAttribute('height', String(Math.round(layout.height * vm.scale)));
        element.classList.toggle('picking', !!vm.selectedId);
        element
            .querySelectorAll<SVGElement>('.fn')
            .forEach((node) => node.classList.toggle('sel', node.dataset.id === vm.selectedId));
        element.querySelectorAll<SVGElement>('.fe').forEach((path) => {
            const edge = layout.edges[Number(path.dataset.i)];
            const on =
                !!vm.selectedId &&
                !!edge &&
                (edge.from === vm.selectedId || edge.to === vm.selectedId);
            path.classList.toggle('on', on);
            path.setAttribute('marker-end', `url(#${on ? 'fc-arrow-on' : 'fc-arrow'})`);
        });
    }, [svg, layout, vm, vm.scale, vm.selectedId]);
    useLayoutEffect(() => {
        const element = canvas.current;
        if (!element) return;
        const wheel = (event: WheelEvent) => {
            if (event.ctrlKey || event.metaKey) {
                event.preventDefault();
                vm.zoom(event.deltaY < 0 ? 1.1 : 1 / 1.1);
            }
        };
        element.addEventListener('wheel', wheel, { passive: false });
        return () => element.removeEventListener('wheel', wheel);
    }, [vm]);
    return (
        <div className="fcanvas" id="fl-canvas" ref={canvas}>
            <div
                id="fl-svgbox"
                ref={host}
                onClick={(event) => {
                    const node = (event.target as Element).closest<SVGElement>('.fn');
                    vm.select(
                        node?.dataset.id && node.dataset.id !== vm.selectedId
                            ? node.dataset.id
                            : null
                    );
                }}
                onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    const node = (event.target as Element).closest<SVGElement>('.fn');
                    if (node?.dataset.id) {
                        event.preventDefault();
                        vm.select(node.dataset.id);
                    }
                }}
            />
        </div>
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
                    <div className="flow-tools">
                        <div className="flow-zoom" role="group" aria-label="Flowchart controls">
                            <button
                                className="btn"
                                id="fl-out"
                                type="button"
                                aria-label="Zoom out"
                                disabled={!hasFlow}
                                onClick={() => vm.zoom(1 / 1.2)}
                            >
                                -
                            </button>
                            <button
                                className="btn"
                                id="fl-fit"
                                type="button"
                                disabled={!hasFlow}
                                onClick={() => {
                                    const canvas = root.current?.querySelector('#fl-canvas');
                                    if (canvas) vm.fit(canvas.clientWidth, canvas.clientHeight);
                                }}
                            >
                                Fit
                            </button>
                            <button
                                className="btn"
                                id="fl-in"
                                type="button"
                                aria-label="Zoom in"
                                disabled={!hasFlow}
                                onClick={() => vm.zoom(1.2)}
                            >
                                +
                            </button>
                            <button
                                className="btn key-toggle"
                                id="flowchart-key-toggle"
                                type="button"
                                aria-expanded={vm.keyOpen}
                                aria-controls="flowchart-key"
                                onClick={vm.toggleKey}
                            >
                                Diagram key
                            </button>
                        </div>
                        <div className="flow-actions">
                            <span
                                className={'status' + (vm.busy ? ' busy' : vm.error ? ' err' : '')}
                                id="fl-status"
                                aria-live="polite"
                            >
                                {vm.status}
                            </span>
                            <button
                                className="btn sm"
                                id="fl-mermaid"
                                type="button"
                                title="Mermaid source, for GitHub, GitLab, Notion and other Markdown tools"
                                disabled={!hasFlow}
                                onClick={vm.copyMermaid}
                            >
                                {vm.copied ? 'Copied' : 'Copy Mermaid'}
                            </button>
                            <button
                                className="btn sm"
                                id="fl-svg"
                                type="button"
                                disabled={!hasFlow}
                                onClick={() => {
                                    const style = getComputedStyle(document.documentElement);
                                    vm.downloadSvg((variable) =>
                                        style.getPropertyValue(variable).trim()
                                    );
                                }}
                            >
                                Download SVG
                            </button>
                            <button
                                className="btn sm"
                                id="fl-stop"
                                type="button"
                                hidden={!vm.busy}
                                onClick={() => vm.stop()}
                            >
                                Stop
                            </button>
                            <button
                                className="btn sm"
                                id="fl-redraw"
                                type="button"
                                title="Ask the AI tool to draw this flowchart again"
                                hidden={!vm.repo.aiAvailable}
                                disabled={vm.busy}
                                onClick={() => {
                                    if (vm.trace) void vm.generate(vm.trace);
                                }}
                            >
                                {hasFlow ? 'Redraw' : 'Draw flowchart'}
                            </button>
                        </div>
                    </div>
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
                        <FlowchartSvg vm={vm} />
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

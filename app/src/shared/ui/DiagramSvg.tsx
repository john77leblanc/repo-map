import { useLayoutEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { layoutFlow } from '../../../flowchart.mjs';

interface DiagramViewModel {
    svg: string;
    layout: ReturnType<typeof layoutFlow> | null;
    scale: number;
    selectedId: string | null;
    fit(width: number, height: number, zoom?: number): void;
    /** When set, the diagram only refits when this changes, so redraws such as collapsing keep the zoom. */
    fitKey?: string;
    zoom(factor: number): void;
    select(id: string | null): void;
    /** Node click handler; defaults to toggling `select`. */
    pick?(id: string): void;
    /** Nodes and layout edge indices to emphasize while the rest dims. */
    highlight?: { nodes: string[]; edges: number[]; primary?: string[] } | null;
    /** Pointer or keyboard focus entering (id) or leaving (null) a node. */
    hoverNode?(id: string | null): void;
    /** Pointer entering (layout edge index) or leaving (null) a path or its caption. Hover only, no click. */
    hoverEdge?(index: number | null): void;
    /** Shift-click: add a node to (or drop it from) a multi-selection. */
    mark?(id: string): void;
    marked?: string[];
    /** Select mode: plain clicks mark instead of opening a node. */
    markMode?: boolean;
    /** Lane heading fold buttons, when the diagram supports collapsing lanes. */
    toggleLane?(id: string): void;
    isLaneCollapsed?(id: string): boolean;
    laneFoldable?(id: string): boolean;
    /** Repo band fold buttons (workspace traces). */
    toggleRepoBand?(id: string): void;
    isRepoCollapsed?(id: string): boolean;
    repoFoldable?(id: string): boolean;
}

/** The right-aligned fold icon button on lane and repo headings. */
function FoldButton({ label, collapsed, onClick, data }: { label: string; collapsed: boolean; onClick: () => void; data: Record<string, string> }) {
    return (
        <button className="btn sm lane-fold" type="button" {...data}
            aria-pressed={collapsed}
            aria-label={collapsed ? `Expand ${label}` : `Collapse ${label}`}
            title={collapsed ? `Expand ${label}` : `Collapse ${label} into one box`}
            onClick={onClick}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
                {collapsed
                    ? <path d="M5 2.5 8 5.5 11 2.5M5 13.5 8 10.5 11 13.5" />
                    : <path d="M5 5.5 8 2.5 11 5.5M5 10.5 8 13.5 11 10.5" />}
            </svg>
        </button>
    );
}

const nodeId = (target: EventTarget | null) =>
    (target instanceof Element ? target.closest<SVGElement>('.fn')?.dataset.id : undefined) || null;
/** Layout edge index under the pointer: a path's wide hit area or its caption. */
const edgeIndex = (target: EventTarget | null) => {
    const item = target instanceof Element ? target.closest<SVGElement>('.fe-hit, .fl') : null;
    return item?.dataset.i ? Number(item.dataset.i) : null;
};

/** React owns the host; only this adapter mutates its generated SVG descendants. */
const DiagramSvg = observer(function DiagramSvg({
    vm,
    prefix = 'fl',
    initialZoom = 1,
}: { vm: DiagramViewModel; prefix?: string; initialZoom?: number }) {
    const host = useRef<HTMLDivElement>(null);
    const canvas = useRef<HTMLDivElement>(null);
    const svg = vm.svg;
    const layout = vm.layout;
    const lanes = layout?.lanes || [];
    const scaledWidth = layout ? Math.round(layout.width * vm.scale) : 0;
    const headerScale = layout?.width ? scaledWidth / layout.width : 1;
    const bands: { id: string; label: string; x: number; w: number }[] = layout?.repoBands || [];
    const laneTop = layout?.laneTop || 0;
    const headerHeight = (56 + laneTop) * headerScale;
    const fitted = useRef<string | null>(null);
    useLayoutEffect(() => {
        if (!host.current) return;
        host.current.innerHTML = svg;
        host.current
            .querySelector('defs')
            ?.insertAdjacentHTML(
                'beforeend',
                '<marker id="fc-arrow-on" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path class="fa on" d="M0 0.5L7.5 4L0 7.5z"/></marker>'
            );
        // Wide invisible copies of each path make thin connectors easy to hover.
        // Interactive view only, so exported SVGs stay unchanged.
        host.current.querySelectorAll<SVGPathElement>('.fe').forEach((path) => {
            const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            hit.setAttribute('class', 'fe-hit');
            hit.setAttribute('d', path.getAttribute('d') || '');
            hit.dataset.i = path.dataset.i || '';
            path.parentNode?.appendChild(hit);
        });
        // Two copies under each node shape draw the main-highlight ring: a wide accent
        // stroke, then a narrower background stroke that leaves an even gap on any shape.
        host.current.querySelectorAll<SVGElement>('.fn .fs').forEach((shape) => {
            for (const name of ['fs-ring', 'fs-gap']) {
                const copy = shape.cloneNode() as SVGElement;
                copy.setAttribute('class', name);
                copy.setAttribute('aria-hidden', 'true');
                shape.parentNode?.insertBefore(copy, shape);
            }
        });
        const key = vm.fitKey;
        if (canvas.current && (key === undefined || key !== fitted.current)) {
            fitted.current = key ?? null;
            vm.fit(canvas.current.clientWidth, canvas.current.clientHeight, initialZoom);
        }
    }, [svg, vm, initialZoom]);
    useLayoutEffect(() => {
        const element = host.current?.querySelector('svg');
        if (!element || !layout) return;
        element.setAttribute('width', String(Math.round(layout.width * vm.scale)));
        element.setAttribute('height', String(Math.round(layout.height * vm.scale)));
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
    // Keep a newly selected node visible, e.g. after following a connection from a side panel.
    useLayoutEffect(() => {
        if (!vm.selectedId || !canvas.current) return;
        const node = host.current?.querySelector<SVGElement>(`.fn[data-id="${CSS.escape(vm.selectedId)}"]`);
        if (!node) return;
        const box = node.getBoundingClientRect();
        const view = canvas.current.getBoundingClientRect();
        if (box.left < view.left || box.right > view.right || box.top < view.top || box.bottom > view.bottom)
            node.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }, [vm.selectedId]);
    const marked = vm.marked;
    useLayoutEffect(() => {
        const set = new Set(marked || []);
        type Box = { id: string; type: string; x: number; y: number; w: number; h: number };
        const boxes = new Map(((layout?.nodes || []) as Box[]).map((n) => [n.id, n]));
        host.current?.querySelectorAll<SVGElement>('.fn').forEach((node) => {
            const id = node.dataset.id || '';
            const on = set.has(id);
            node.classList.toggle('mk', on);
            // A check badge on the box's top-right corner (on the edge for diamonds).
            node.querySelector('.mk-badge')?.remove();
            const label = (node.getAttribute('aria-label') || '').replace(/, selected$/, '');
            node.setAttribute('aria-label', on ? label + ', selected' : label);
            const box = boxes.get(id);
            if (!on || !box) return;
            const diamond = box.type === 'decision';
            const cx = diamond ? box.x + box.w * 0.75 : box.x + box.w - 2;
            const cy = diamond ? box.y + box.h * 0.25 : box.y + 2;
            const badge = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            badge.setAttribute('class', 'mk-badge');
            badge.setAttribute('aria-hidden', 'true');
            badge.setAttribute('transform', `translate(${cx.toFixed(1)},${cy.toFixed(1)})`);
            badge.innerHTML = '<circle r="9"/><path d="M-4 0.5 -1.2 3.3 4 -2.6"/>';
            node.appendChild(badge);
        });
    }, [svg, marked, layout]);
    const highlight = vm.highlight;
    useLayoutEffect(() => {
        const element = host.current?.querySelector('svg');
        if (!element) return;
        const nodes = new Set(highlight?.nodes || []);
        const edges = new Set((highlight?.edges || []).map(String));
        const primary = new Set(highlight?.primary || []);
        element.classList.toggle('hovering', !!highlight && (nodes.size > 0 || edges.size > 0));
        element.querySelectorAll<SVGElement>('.fn').forEach((node) => {
            node.classList.toggle('hl', nodes.has(node.dataset.id || ''));
            node.classList.toggle('hl-main', primary.has(node.dataset.id || ''));
        });
        element.querySelectorAll<SVGElement>('.fe, .fl').forEach((item) => item.classList.toggle('hl', edges.has(item.dataset.i || '')));
        element.querySelectorAll<SVGElement>('.fe').forEach((path) => path.setAttribute('marker-end',
            `url(#${path.classList.contains('hl') || path.classList.contains('on') ? 'fc-arrow-on' : 'fc-arrow'})`));
        // Highlighted captions move to the end of their layer so other captions never cover them.
        const captions = element.querySelector('.fl-all');
        captions?.querySelectorAll('.fl.hl').forEach((label) => captions.appendChild(label));
    }, [svg, highlight, vm.selectedId]);
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
        <div className={'fcanvas' + (lanes.length ? ' diagram-with-lanes' : '')} id={prefix + '-canvas'} ref={canvas}>
            {lanes.length > 0 && (
                <div className="diagram-lane-headings" style={{
                    width: scaledWidth + 24,
                    height: headerHeight,
                    marginBottom: -headerHeight,
                }} role="group" aria-label="Execution lanes">
                    <div className="diagram-lane-heading-row" style={{ width: scaledWidth }}>
                        {bands.map((band) => (
                            <div key={'repo:' + band.id} className="diagram-lane-title diagram-repo-title" data-repo-band={band.id} style={{
                                left: (band.x - 4) * headerScale,
                                width: (band.w + 8) * headerScale,
                                top: 2 * headerScale,
                                height: (laneTop - 2) * headerScale,
                                fontSize: 13 * headerScale,
                            }}>
                                <span className="lane-name">{band.label}</span>
                                {vm.toggleRepoBand && (vm.isRepoCollapsed?.(band.id) || vm.repoFoldable?.(band.id)) && (
                                    <FoldButton label={band.label} collapsed={!!vm.isRepoCollapsed?.(band.id)}
                                        data={{ 'data-repo-band-fold': band.id }} onClick={() => vm.toggleRepoBand?.(band.id)} />
                                )}
                            </div>
                        ))}
                        {lanes.map((lane) => (
                            <div key={lane.id} className="diagram-lane-title" style={{
                                left: lane.x * headerScale,
                                width: lane.w * headerScale,
                                top: (8 + laneTop) * headerScale,
                                height: 48 * headerScale,
                                fontSize: 14 * headerScale,
                            }}>
                                <span className="lane-name">{lane.label}</span>
                                {vm.toggleLane && lane.id && (vm.isLaneCollapsed?.(lane.id) || vm.laneFoldable?.(lane.id)) && (
                                    <FoldButton label={lane.label} collapsed={!!vm.isLaneCollapsed?.(lane.id)}
                                        data={{ 'data-lane': lane.id }} onClick={() => vm.toggleLane?.(lane.id)} />
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
            <div
                id={prefix + '-svgbox'}
                ref={host}
                onMouseOver={(event) => {
                    const id = nodeId(event.target);
                    const edge = id ? null : edgeIndex(event.target);
                    if (edge !== null && vm.hoverEdge) vm.hoverEdge(edge);
                    else vm.hoverNode?.(id);
                }}
                onMouseLeave={() => vm.hoverNode?.(null)}
                onFocus={(event) => vm.hoverNode?.(nodeId(event.target))}
                onBlur={() => vm.hoverNode?.(null)}
                onClick={(event) => {
                    // Paths and captions are hover-only; clicking them keeps the current selection.
                    if (edgeIndex(event.target) !== null) return;
                    const node = (event.target as Element).closest<SVGElement>('.fn');
                    if (node?.dataset.id && (event.shiftKey || vm.markMode) && vm.mark) return vm.mark(node.dataset.id);
                    if (node?.dataset.id && vm.pick) return vm.pick(node.dataset.id);
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
                        if ((event.shiftKey || vm.markMode) && vm.mark) vm.mark(node.dataset.id);
                        else vm.select(node.dataset.id);
                    }
                }}
            />
        </div>
    );
});


export { DiagramSvg };

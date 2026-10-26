import { useLayoutEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { layoutFlow } from '../../../flowchart.mjs';

interface DiagramViewModel {
    svg: string;
    layout: ReturnType<typeof layoutFlow> | null;
    scale: number;
    selectedId: string | null;
    fit(width: number, height: number, zoom?: number): void;
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
    /** Lane heading fold buttons, when the diagram supports collapsing lanes. */
    toggleLane?(id: string): void;
    isLaneCollapsed?(id: string): boolean;
    laneFoldable?(id: string): boolean;
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
    const headerHeight = 56 * headerScale;
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
        if (canvas.current)
            vm.fit(canvas.current.clientWidth, canvas.current.clientHeight, initialZoom);
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
        host.current?.querySelectorAll<SVGElement>('.fn').forEach((node) => node.classList.toggle('mk', set.has(node.dataset.id || '')));
    }, [svg, marked]);
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
                        {lanes.map((lane) => (
                            <div key={lane.id} className="diagram-lane-title" style={{
                                left: lane.x * headerScale,
                                width: lane.w * headerScale,
                                top: 8 * headerScale,
                                height: 48 * headerScale,
                                fontSize: 14 * headerScale,
                            }}>
                                <span className="lane-name">{lane.label}</span>
                                {vm.toggleLane && lane.id && (vm.isLaneCollapsed?.(lane.id) || vm.laneFoldable?.(lane.id)) && (
                                    <button className="btn sm lane-fold" type="button" data-lane={lane.id}
                                        aria-pressed={!!vm.isLaneCollapsed?.(lane.id)}
                                        title={vm.isLaneCollapsed?.(lane.id) ? `Expand ${lane.label}` : `Collapse ${lane.label} into one box`}
                                        onClick={() => vm.toggleLane?.(lane.id)}>
                                        {vm.isLaneCollapsed?.(lane.id) ? 'Expand' : 'Collapse'}
                                    </button>
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
                    if (node?.dataset.id && event.shiftKey && vm.mark) return vm.mark(node.dataset.id);
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
                        if (event.shiftKey && vm.mark) vm.mark(node.dataset.id);
                        else vm.select(node.dataset.id);
                    }
                }}
            />
        </div>
    );
});


export { DiagramSvg };

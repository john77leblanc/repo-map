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
}

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
        if (canvas.current)
            vm.fit(canvas.current.clientWidth, canvas.current.clientHeight, initialZoom);
    }, [svg, vm, initialZoom]);
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
                                {lane.label}
                            </div>
                        ))}
                    </div>
                </div>
            )}
            <div
                id={prefix + '-svgbox'}
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


export { DiagramSvg };

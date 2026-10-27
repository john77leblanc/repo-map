import { useLayoutEffect, useState, type RefObject } from 'react';
import type { ArchitectureViewModel } from './ArchitectureViewModel';
import type { MapEdge } from '../../models/types';

export interface Wire {
    d: string;
    edges: MapEdge[];
}
/** The original card/group anchoring and cubic geometry, measured only by the view. */
export function useArchitectureWires(
    board: RefObject<HTMLDivElement | null>,
    vm: ArchitectureViewModel
) {
    const [geometry, setGeometry] = useState<{ width: number; height: number; wires: Wire[] }>({
        width: 0,
        height: 0,
        wires: [],
    });
    const signature = JSON.stringify([vm.shown, vm.groups, vm.hidden, vm.keyOpen]);
    useLayoutEffect(() => {
        const root = board.current;
        if (!root) return;
        let frame = 0;
        const draw = () => {
            const br = root.getBoundingClientRect();
            const cards = new Map(
                Array.from(root.querySelectorAll<HTMLElement>('.node')).map((el) => [
                    el.dataset.id!,
                    el,
                ])
            );
            const anchor = (id: string) => {
                const el = cards.get(id),
                    group = el?.closest('details');
                return group && !group.open
                    ? group.querySelector('summary')
                    : el?.querySelector('.nh');
            };
            const wires: Wire[] = [],
                seen = new Map<string, Wire>();
            const keys = new Map<Element, number>();
            const key = (el: Element) => {
                if (!keys.has(el)) keys.set(el, keys.size);
                return keys.get(el);
            };
            for (const e of vm.shown.edges) {
                if (vm.hidden[e.type]) continue;
                const a = anchor(e.from),
                    b = anchor(e.to);
                if (!a || !b || a === b) continue;
                const k = `${key(a)}|${key(b)}|${e.type}|${!!e.inferred}|${e.status || ''}`;
                const previous = seen.get(k);
                if (previous) {
                    previous.edges.push(e);
                    continue;
                }
                const ar = a.getBoundingClientRect(),
                    tr = b.getBoundingClientRect();
                const s = {
                    l: ar.left - br.left,
                    r: ar.right - br.left,
                    cy: ar.top - br.top + ar.height / 2,
                };
                const t = {
                    l: tr.left - br.left,
                    r: tr.right - br.left,
                    cy: tr.top - br.top + tr.height / 2,
                };
                let x1: number, x2: number, d: string;
                const y1 = s.cy,
                    y2 = t.cy;
                if (t.l >= s.r - 4) {
                    x1 = s.r;
                    x2 = t.l - 2;
                    const dx = Math.max(36, (x2 - x1) * 0.5);
                    d = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
                } else if (t.r <= s.l + 4) {
                    x1 = s.l;
                    x2 = t.r + 2;
                    const dx = Math.max(36, (x1 - x2) * 0.5);
                    d = `M${x1},${y1} C${x1 - dx},${y1} ${x2 + dx},${y2} ${x2},${y2}`;
                } else {
                    x1 = s.r;
                    x2 = t.r + 2;
                    const xm = Math.max(x1, x2) + Math.min(70, 26 + Math.abs(y2 - y1) * 0.12);
                    d = `M${x1},${y1} C${xm},${y1} ${xm},${y2} ${x2},${y2}`;
                }
                const wire = { d, edges: [e] };
                seen.set(k, wire);
                wires.push(wire);
            }
            setGeometry({ width: root.scrollWidth, height: root.scrollHeight, wires });
        };
        const schedule = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(draw);
        };
        const observer =
            typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
        observer?.observe(root);
        root.querySelectorAll('.grp,.nh').forEach((el) => observer?.observe(el));
        window.addEventListener('resize', schedule);
        schedule();
        return () => {
            cancelAnimationFrame(frame);
            observer?.disconnect();
            window.removeEventListener('resize', schedule);
        };
    }, [board, vm, signature]);
    return geometry;
}

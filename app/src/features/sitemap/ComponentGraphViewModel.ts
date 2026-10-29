import { makeAutoObservable, observableRef } from 'mobx';
import { anchorBranchCaptions, fitCaptions, layoutFlow, renderFlowSvg } from '../../../flowchart.mjs';
import { componentUsage, rootsFor } from '../../../../lib/components-data.mjs';
import { DiagramFocusModel } from '../../shared/DiagramFocusModel';
import type { ComponentMap, Sitemap, UiComponent } from '../../models/types';

/** All screens, rather than one. */
const ALL = '*';
const SCREEN = 'screen:';
type ComponentSection = 'about' | 'screens' | 'connections' | 'refs';
type ComponentTab = 'from' | 'to';

/**
 * The Components diagram inside Sitemap: screens on top, the components at the
 * top of each, then what those render. Component ids never contain ":", so
 * screen nodes use a `screen:` prefix.
 */
class ComponentGraphViewModel {
    /** A screen id, or ALL; '' picks the first screen with components. */
    scopeId = '';
    selectedId: string | null = null;
    detailsOpen = false;
    sections: Record<ComponentSection, boolean> = { about: true, screens: false, connections: true, refs: false };
    connectionTab: ComponentTab = 'to';
    scale = 1;
    /** Side-panel hover: node ids to keep bright. */
    hoverIds: string[] | null = null;
    readonly focus = new DiagramFocusModel({
        layout: () => this.layout,
        selected: () => this.selectedId,
        override: () => this.hoverIds && this.layout ? { nodes: this.hoverIds, edges: [], primary: this.hoverIds } : null,
    });

    constructor(private readonly source: { sitemap: () => Sitemap | null; components: () => ComponentMap | null }) {
        makeAutoObservable<this, 'source'>(this, { source: false, focus: false, hoverIds: observableRef }, { autoBind: true });
    }
    get map() { return this.source.components(); }
    get screens() {
        const map = this.map;
        const linked = new Set(map?.screens.map((s) => s.screen) || []);
        return (this.source.sitemap()?.screens || []).filter((s) => linked.has(s.id));
    }
    get scope() {
        if (this.scopeId === ALL) return ALL;
        return this.screens.some((s) => s.id === this.scopeId) ? this.scopeId : this.screens[0]?.id || ALL;
    }
    get byId(): Map<string, UiComponent> { return new Map((this.map?.components || []).map((c) => [c.id, c])); }
    get usage(): Map<string, string[]> { return this.map ? componentUsage(this.map) : new Map(); }
    /** Component id → components it renders, and → components that render it. */
    get links() {
        const renders = new Map<string, string[]>(), renderedBy = new Map<string, string[]>();
        for (const { from, to } of this.map?.uses || []) {
            renders.set(from, [...(renders.get(from) || []), to]);
            renderedBy.set(to, [...(renderedBy.get(to) || []), from]);
        }
        return { renders, renderedBy };
    }
    screenLabel(id: string) { return this.source.sitemap()?.screens.find((s) => s.id === id)?.label || id; }
    label(id: string) { return this.byId.get(id)?.label || id; }
    get graph() {
        const map = this.map;
        if (!map) return { nodes: [], edges: [] };
        const shown = this.scope === ALL ? this.screens : this.screens.filter((s) => s.id === this.scope);
        const edges: { from: string; to: string }[] = [];
        const visible = new Set<string>();
        const stack: string[] = [];
        for (const screen of shown) for (const root of rootsFor(map, screen.id)) {
            edges.push({ from: SCREEN + screen.id, to: root });
            stack.push(root);
        }
        while (stack.length) {
            const id = stack.pop()!;
            if (visible.has(id)) continue;
            visible.add(id);
            stack.push(...(this.links.renders.get(id) || []));
        }
        for (const use of map.uses) if (visible.has(use.from) && visible.has(use.to)) edges.push(use);
        const nodes = [
            ...shown.map((s) => ({ id: SCREEN + s.id, type: 'start', label: s.label })),
            ...map.components.filter((c) => visible.has(c.id)).map((c) => {
                const count = this.usage.get(c.id)?.length || 0;
                return { id: c.id, type: 'process', label: count > 1 ? `${c.label} · ${count} screens` : c.label };
            }),
        ];
        return { nodes, edges };
    }
    get layout() {
        if (!this.graph.nodes.length) return null;
        return fitCaptions(anchorBranchCaptions(layoutFlow(this.graph, { lanes: false })));
    }
    get svg() { return this.layout ? renderFlowSvg(this.layout, { title: 'Components' }) : ''; }
    get fitKey() { return this.scope; }
    get highlight() { return this.focus.highlight; }
    get selected() { return this.selectedId ? this.byId.get(this.selectedId) || null : null; }
    hoverNode(id: string | null) { this.focus.hover(id); }
    hoverEdge(index: number | null) { this.focus.hoverEdge(index); }
    hover(ids: string[] | null) { this.hoverIds = ids?.length ? ids : null; }
    setScope(id: string) {
        this.scopeId = id;
        this.hoverIds = null;
        this.focus.reset();
        if (this.selectedId && !this.graph.nodes.some((n) => n.id === this.selectedId)) this.closeDetails();
    }
    /** Diagram click: a screen narrows the diagram to it; a component opens its panel (again to close). */
    pick(id: string) {
        if (id.startsWith(SCREEN)) { this.setScope(id.slice(SCREEN.length)); return; }
        this.select(id === this.selectedId ? null : id);
    }
    select(id: string | null) {
        if (id?.startsWith(SCREEN)) { this.setScope(id.slice(SCREEN.length)); return; }
        if (id && !this.byId.has(id)) return;
        this.selectedId = id;
        this.hoverIds = null;
        if (!id) { this.detailsOpen = false; return; }
        this.detailsOpen = true;
        this.connectionTab = (this.links.renders.get(id) || []).length || !(this.links.renderedBy.get(id) || []).length ? 'to' : 'from';
        // Keep the component on the diagram: widen to all screens when this one does not show it.
        if (!this.graph.nodes.some((n) => n.id === id)) this.scopeId = ALL;
    }
    /** Open one screen's diagram with a component selected (from the screen panel's tree). */
    show(screenId: string, componentId: string) {
        this.setScope(screenId);
        this.select(componentId);
    }
    closeDetails() { this.detailsOpen = false; this.selectedId = null; }
    setSection(name: ComponentSection, open: boolean) { this.sections[name] = open; }
    setConnectionTab(tab: ComponentTab) { this.connectionTab = tab; }
    zoom(factor: number) { this.scale = Math.max(0.15, Math.min(2.5, this.scale * factor)); }
    fit(width: number, height: number, zoom = 1) {
        if (this.layout) this.scale = Math.max(0.15, Math.min(1, (width - 24) / this.layout.width, (height - 24) / this.layout.height) * zoom);
    }
    reset() {
        this.closeDetails();
        this.hoverIds = null;
        this.focus.reset();
    }
}

export { ALL as ALL_SCREENS, ComponentGraphViewModel };
export type { ComponentSection, ComponentTab };

import { makeAutoObservable, observableRef } from 'mobx';
import { anchorBranchCaptions, fitCaptions, layoutFlow, renderFlowSvg } from '../../../flowchart.mjs';
import { componentUsage, rootsFor } from '../../../../lib/components-data.mjs';
import { componentsTouched } from '../../../../lib/components-trace.mjs';
import { DiagramFocusModel } from '../../shared/DiagramFocusModel';
import { SearchModel, pinFirst, type SearchSection } from '../../shared/search/SearchModel';
import type { ComponentChange, ComponentMap, ComponentsTrace, ComponentUseChange, Sitemap, UiComponent } from '../../models/types';

/** Every component, starting from the ones nothing else renders. */
const ROOTS = '*';
/** A trace's components: the ones it involves or changes. */
const TRACE = 'trace';
const useKey = (use: { from: string; to: string }) => use.from + '\n' + use.to;
type ComponentSection = 'about' | 'usedIn' | 'connections' | 'refs';
type ComponentTab = 'from' | 'to';

/**
 * The Components diagram: components only (no screen boxes). **All roots** shows every
 * component, with the ones nothing renders on top; a screen shows that screen's root
 * components and what they render. In a trace, **This trace** shows the components it
 * involves or changes, and changes are marked everywhere.
 */
class ComponentGraphViewModel {
    /** A screen id, ROOTS, or TRACE. */
    scopeId = ROOTS;
    selectedId: string | null = null;
    detailsOpen = false;
    sections: Record<ComponentSection, boolean> = { about: true, usedIn: false, connections: true, refs: false };
    connectionTab: ComponentTab = 'to';
    scale = 1;
    /** Side-panel hover: node ids to keep bright. */
    hoverIds: string[] | null = null;
    readonly focus = new DiagramFocusModel({
        layout: () => this.layout,
        selected: () => this.selectedId,
        override: () => this.hoverIds && this.layout ? { nodes: this.hoverIds, edges: [], primary: this.hoverIds } : null,
    });

    /** Search over every component, in the side panel. */
    readonly search = new SearchModel({ sections: () => this.searchSource });

    constructor(private readonly source: { sitemap: () => Sitemap | null; components: () => ComponentMap | null; output?: () => ComponentsTrace | null; review?: () => boolean }) {
        makeAutoObservable<this, 'source'>(this, { source: false, focus: false, search: false, hoverIds: observableRef }, { autoBind: true });
    }
    get map() { return this.source.components(); }
    /** Sitemap screens that have components, in sitemap order. */
    get screens() {
        const linked = new Set(this.map?.screens.map((s) => s.screen) || []);
        return (this.source.sitemap()?.screens || []).filter((s) => linked.has(s.id));
    }
    /** The trace's Components output, if a trace is open. */
    get output() { return this.source.output?.() || null; }
    get scope() {
        if (this.scopeId === TRACE) return this.output ? TRACE : ROOTS;
        return this.screens.some((s) => s.id === this.scopeId) ? this.scopeId : ROOTS;
    }
    /** Components the trace involves or changes. */
    get touched(): Set<string> { return this.output ? componentsTouched(this.output) : new Set(); }
    changeFor(id: string): ComponentChange | undefined { return this.output?.changes.components.find((c) => c.id === id); }
    originalFor(id: string): UiComponent | undefined { return this.output?.base.components.find((c) => c.id === id); }
    /** Changed render links, by from and to. */
    get useChanges(): Map<string, ComponentUseChange> { return new Map((this.output?.changes.uses || []).map((u) => [useKey(u), u])); }
    /** Render links to or from a component that the trace adds or removes. */
    changedUses(id: string) { return (this.output?.changes.uses || []).filter((u) => u.from === id || u.to === id); }
    /** Where a component sits in the trace's involved list (-1 when it isn't on it). */
    involvedIndex(id: string) { return this.output?.involved.findIndex((i) => i.id === id) ?? -1; }
    get byId(): Map<string, UiComponent> { return new Map((this.map?.components || []).map((c) => [c.id, c])); }
    /** Component id → sorted screen ids whose tree includes it. */
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
    /** Components nothing else renders, in map order. */
    get roots(): string[] {
        return (this.map?.components || []).filter((c) => !(this.links.renderedBy.get(c.id) || []).length).map((c) => c.id);
    }
    screenLabel(id: string) { return this.source.sitemap()?.screens.find((s) => s.id === id)?.label || id; }
    screenRoute(id: string) { return this.source.sitemap()?.screens.find((s) => s.id === id)?.route || ''; }
    label(id: string) { return this.byId.get(id)?.label || id; }
    get graph() {
        const map = this.map;
        if (!map) return { nodes: [], edges: [] };
        let visible: Set<string>;
        if (this.scope === ROOTS) visible = new Set(map.components.map((c) => c.id));
        else if (this.scope === TRACE) visible = this.touched;
        else {
            visible = new Set();
            const stack = [...rootsFor(map, this.scope)];
            while (stack.length) {
                const id = stack.pop()!;
                if (visible.has(id)) continue;
                visible.add(id);
                stack.push(...(this.links.renders.get(id) || []));
            }
        }
        // Roots first, so the layout puts them on the top row.
        // In a trace, the involved components in the order the person meets them.
        const top = new Set(this.scope === ROOTS ? this.roots : this.scope === TRACE ? this.output!.involved.map((i) => i.id) : rootsFor(map, this.scope));
        const ordered = [...map.components.filter((c) => top.has(c.id)), ...map.components.filter((c) => !top.has(c.id))];
        const status = (id: string) => this.changeFor(id)?.status;
        const changes = this.useChanges;
        return {
            nodes: ordered.filter((c) => visible.has(c.id)).map((c) => ({ id: c.id, type: 'process', label: c.label,
                ...(status(c.id) ? { status: status(c.id) } : {}) })),
            edges: map.uses.filter((use) => visible.has(use.from) && visible.has(use.to)).map((use) => {
                const change = changes.get(useKey(use));
                return change ? { from: use.from, to: use.to, status: change.status } : { from: use.from, to: use.to };
            }),
        };
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
    /** Diagram click: opens the component's panel (again to close). */
    pick(id: string) { this.select(id === this.selectedId ? null : id); }
    select(id: string | null) {
        if (id && !this.byId.has(id)) return;
        this.selectedId = id;
        this.hoverIds = null;
        if (!id) { this.detailsOpen = false; return; }
        this.detailsOpen = true;
        this.connectionTab = (this.links.renders.get(id) || []).length || !(this.links.renderedBy.get(id) || []).length ? 'to' : 'from';
        // Keep the component on the diagram: widen to all roots when this screen does not show it.
        if (!this.graph.nodes.some((n) => n.id === id)) this.scopeId = ROOTS;
    }
    /** The trace's involved components, one after another, like trace steps. */
    get stepIndex() { return this.selectedId ? this.involvedIndex(this.selectedId) : -1; }
    get hasPrev() { return this.stepIndex > 0; }
    get hasNext() { const i = this.stepIndex; return i >= 0 && i < (this.output?.involved.length ?? 0) - 1; }
    prevStep() { if (this.hasPrev) this.select(this.output!.involved[this.stepIndex - 1].id); }
    nextStep() { if (this.hasNext) this.select(this.output!.involved[this.stepIndex + 1].id); }
    /** A trace opened or closed: its own components, or all roots. */
    resetFor(trace: boolean) {
        this.reset();
        this.scopeId = trace ? TRACE : ROOTS;
    }
    /** One screen's diagram, optionally with a component selected (from the Sitemap). */
    show(screenId: string, componentId?: string) {
        this.setScope(screenId);
        if (componentId) this.select(componentId);
        else this.closeDetails();
    }
    closeDetails() { this.detailsOpen = false; this.selectedId = null; }
    /** Roots, then the rest; in a trace, the components it involves first. */
    get searchSource(): SearchSection[] {
        const roots = new Set(this.roots);
        const item = (c: UiComponent) => ({ id: c.id, title: c.label, names: [c.id, c.label, ...c.tags], desc: c.detail,
            paths: c.refs.map((r) => r.path), kind: 'component' });
        const all = this.map?.components || [];
        const sections = [
            { id: 'roots', title: 'Roots', groups: [{ id: 'roots', title: '', items: all.filter((c) => roots.has(c.id)).map(item) }] },
            { id: 'other', title: 'Other components', groups: [{ id: 'other', title: '', items: all.filter((c) => !roots.has(c.id)).map(item) }] },
        ];
        const involved = this.output ? [...this.output.involved.map((i) => i.id), ...this.touched] : [];
        return pinFirst(sections, involved, this.source.review?.() ? 'In this review' : 'In this trace');
    }
    get matched() { return this.search.matched; }
    /** The side panel shows a component, or the search results. */
    get sideOpen() { return this.search.open || (this.detailsOpen && !!this.selected); }
    openSearch() {
        this.search.openSearch();
        this.closeDetails();
    }
    /** Toolbar Search: closes the results when they are showing, else opens them. */
    toggleSearch() {
        if (this.search.open && !this.selected) this.dismiss();
        else this.openSearch();
    }
    /** Escape: from a component back to the results, else close the panel. False when nothing is open. */
    escape() {
        if (!this.search.open) return false;
        if (this.selected) this.closeDetails();
        else this.dismiss();
        return true;
    }
    /** Close the side panel: the component and the search. */
    dismiss() {
        this.search.close();
        this.closeDetails();
    }
    /** Hovering a search result keeps that component bright. */
    hoverHit(id: string | null) { this.hover(id ? [id] : null); }
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

export { ROOTS, TRACE, ComponentGraphViewModel };
export type { ComponentSection, ComponentTab };

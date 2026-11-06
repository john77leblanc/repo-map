import { makeAutoObservable, observableRef, runInAction } from 'mobx';
import { ProgressLog } from '../../models/ProgressLog';
import type { RepositoryModel } from '../../models/RepositoryModel';
import type { ComponentMap, ComponentNode, UiComponent, Sitemap, SitemapNavigation, SitemapResult, SitemapTrace, Trace, AgentPick, StreamResult, ChangeStatus } from '../../models/types';
import { plain } from '../../models/trace';
import { normalizeSitemapTrace, composeSitemapTrace } from '../../../../lib/sitemap-trace.mjs';
import { componentTree, rootsFor } from '../../../../lib/components-data.mjs';
import type { Services } from '../../shared/services/contracts';
import { anchorBranchCaptions, fitCaptions, layoutFlow, renderFlowSvg } from '../../../flowchart.mjs';
import { DiagramFocusModel } from '../../shared/DiagramFocusModel';
import { flowToMermaid } from '../../../../lib/flow.mjs';
import { DiagramExport, diagramFilename, type ExportFormat, type ExportSource } from '../../shared/diagramExport';
import { FC_CSS } from '../flowchart/styles';
import { SITEMAP_CSS } from './styles';
import { CopyFeedback } from '../../models/CopyFeedback';
import { SearchModel, pinFirst, type SearchSection } from '../../shared/search/SearchModel';

type SitemapScope = 'trace' | 'nearby' | 'app';
type ConnectionTab = 'from' | 'to';
/** Collapsible sections of the screen panel. */
type ScreenSection = 'about' | 'components' | 'nav' | 'refs';
type NavEdge = SitemapNavigation & { status?: ChangeStatus; rationale?: string; index?: number };
/** One navigation link seen from a screen: `other` is the screen at the far end. */
interface Connection { edge: NavEdge; nav: number; other: string; journey: boolean; original: SitemapNavigation | null }

interface SitemapDeps {
    repo: RepositoryModel;
    services: Services;
    getPick?: () => AgentPick;
    saveTrace?: (trace: Trace) => Promise<void>;
    /** The repository component map (owned by the Components view). */
    components?: () => ComponentMap | null;
    /** To the Components view, scoped to a screen, optionally with a component open. */
    showComponents?: (screenId: string, componentId?: string) => void;
}

class SitemapViewModel {
    sitemap: Sitemap | null = null;
    trace: Trace | null = null;
    scope: SitemapScope = 'trace';
    infoOpen = false;
    /** The screen panel: closed until a screen is picked. */
    detailsOpen = false;
    /** Open screen sections; kept while moving between screens. */
    sections: Record<ScreenSection, boolean> = { about: false, components: false, nav: false, refs: false };
    /** The screen whose component tree is open in its own window, or null. */
    treeScreenId: string | null = null;
    actionsOpen = false;
    keyOpen = false;
    readonly copy = new CopyFeedback();
    readonly exports: DiagramExport;
    stepIndex: number | null = null;
    freshness: SitemapResult['status'] = { state: 'missing' };
    appId = '';
    selectedId: string | null = null;
    connectionTab: ConnectionTab = 'to';
    highlightIds: { nodes: string[]; navs: number[]; primary: string[] } | null = null;
    scale = 1;
    loading = false;
    busy = false;
    message = '';
    /** Progress of the last sitemap generation, for the one-line status and its history. */
    readonly log = new ProgressLog();
    error = false;
    readonly focus = new DiagramFocusModel({
        layout: () => this.layout,
        selected: () => this.selectedId,
        override: () => this.panelHighlight,
    });
    /** Search over the screens on the diagram, in the side panel. */
    readonly search = new SearchModel({ sections: () => this.searchSource });
    private controller: AbortController | null = null;
    private disposed = false;
    private copyRevision = 0;

    constructor(readonly deps: SitemapDeps) {
        this.exports = new DiagramExport(deps.services, () => this.exportSource(), (message) => {
            if (!this.disposed) runInAction(() => {
                this.message = message;
                this.error = true;
            });
        });
        makeAutoObservable<this, 'controller' | 'disposed' | 'copyRevision'>(this, {
            deps: false, focus: false, copy: false, exports: false, search: false, sitemap: observableRef, trace: observableRef, highlightIds: observableRef, controller: false, disposed: false,
            copyRevision: false,
        }, { autoBind: true });
    }
    /** The Export button reads "Copied!" for a moment after Copy Mermaid. */
    get copied() { return this.copy.copied; }
    get repo() { return this.deps.repo; }
    /** The repository component map, for the screen panel (repository sitemap only, not traces). */
    get components(): ComponentMap | null { return this.trace ? null : this.deps.components?.() ?? null; }
    /** The screen's root components (usually its page component). */
    rootComponents(screenId: string): UiComponent[] {
        const map = this.components;
        if (!map) return [];
        const byId = new Map(map.components.map((c) => [c.id, c]));
        return rootsFor(map, screenId).flatMap((id: string) => byId.get(id) || []) as UiComponent[];
    }
    /** To the Components view, scoped to a screen, optionally with a component open. */
    showComponent(screenId: string, componentId?: string) {
        this.closeComponentTree();
        this.hoverScreen(null);
        this.deps.showComponents?.(screenId, componentId);
    }
    get treeOpen() { return this.treeScreenId !== null; }
    /** The selected screen's component tree, in its own window. */
    openComponentTree() { if (this.selectedId) this.treeScreenId = this.selectedId; }
    closeComponentTree() { this.treeScreenId = null; }
    /** From the component tree window: the Components view scoped to that screen. */
    showTreeInDiagram() {
        const id = this.treeScreenId;
        if (id) this.showComponent(id);
    }
    /** The component trees at the top of a screen. */
    componentTrees(screenId: string): ComponentNode[] {
        const map = this.components;
        if (!map) return [];
        return rootsFor(map, screenId).map((root: string) => componentTree(map, root) as ComponentNode | null).filter((n: ComponentNode | null): n is ComponentNode => !!n);
    }
    get output() { return this.trace?.sitemap; }
    get displayed(): Sitemap | null { return this.output ? composeSitemapTrace(this.output) as Sitemap : this.trace ? null : this.sitemap; }
    get applications() { return this.displayed?.applications || []; }
    get selected() { return this.displayed?.screens.find((screen) => screen.id === this.selectedId) || null; }
    screen(id: string) { return this.displayed?.screens.find((screen) => screen.id === id) || null; }
    changeFor(id: string) { return this.output?.changes.screens.find((screen) => screen.id === id); }
    originalFor(id: string) { return this.output?.base.screens.find((screen) => screen.id === id); }
    get selectedChange() { return this.selectedId ? this.changeFor(this.selectedId) : undefined; }
    get original() { return this.selectedId ? this.originalFor(this.selectedId) : undefined; }
    get selectedStep() { return this.stepIndex === null ? null : this.output?.steps[this.stepIndex]; }
    get involved() {
        const result = new Set(this.output?.steps.map((s) => s.screen) || []);
        this.output?.changes.screens.forEach((s) => result.add(s.id));
        this.output?.navigation.forEach((index) => {
            const edge = this.output!.base.navigation[index];
            if (edge) { result.add(edge.from); result.add(edge.to); }
        });
        this.output?.changes.navigation.forEach((e) => { result.add(e.from); result.add(e.to); });
        return result;
    }
    setTrace(trace: Trace | null) {
        if (this.trace === trace) return;
        this.stop();
        this.treeScreenId = null;
        this.resetCopy();
        this.actionsOpen = false;
        this.message = '';
        this.error = false;
        this.trace = trace;
        this.scope = 'trace';
        this.selectedId = null;
        this.stepIndex = null;
        this.highlightIds = null;
        this.focus.reset();
        this.appId = this.displayed?.screens.find((s) => this.involved.has(s.id))?.app || this.applications[0]?.id || '';
    }
    get wholeApplication() { return this.scope === 'app'; }
    setScope(scope: SitemapScope) { this.resetCopy(); this.scope = scope; this.highlightIds = null; this.focus.reset(); }
    setConnectionTab(tab: ConnectionTab) { this.connectionTab = tab; }
    hoverConnection(connection: Connection | null) {
        this.highlightIds = connection ? { nodes: [connection.edge.from, connection.edge.to], navs: [connection.nav], primary: [connection.other] } : null;
    }
    hoverScreen(id: string | null) { this.highlightIds = id ? { nodes: [id], navs: [], primary: [id] } : null; }
    /** Side-panel hover as layout indices; hidden screens and links are skipped. */
    get panelHighlight() {
        if (!this.highlightIds || !this.layout) return null;
        const navs = new Set(this.highlightIds.navs);
        const edges = this.layout.edges.flatMap((edge: { nav?: number }, i: number) => navs.has(edge.nav ?? -1) ? [i] : []);
        return { nodes: this.highlightIds.nodes, edges, primary: this.highlightIds.primary };
    }
    /** What DiagramSvg keeps bright: side-panel hover, then diagram hover, then the selected screen. */
    get highlight() { return this.focus.highlight; }
    hoverNode(id: string | null) { this.focus.hover(id); }
    hoverEdge(index: number | null) { this.focus.hoverEdge(index); }
    toggleInfo() { this.infoOpen = !this.infoOpen; }
    setSection(name: ScreenSection, open: boolean) { this.sections[name] = open; }
    /** The journey step shown in the panel, or -1 for a screen off the journey. */
    get currentStep() { return this.stepIndex ?? -1; }
    get hasPrev() { return this.currentStep > 0; }
    get hasNext() { const i = this.currentStep; return i >= 0 && i < (this.output?.steps.length ?? 0) - 1; }
    prevStep() { if (this.hasPrev) this.openStep(this.currentStep - 1); }
    nextStep() { if (this.hasNext) this.openStep(this.currentStep + 1); }
    /** Screens on the diagram by application; in a trace, its journey first. */
    get searchSource(): SearchSection[] {
        const navigation = (this.displayed?.navigation || []) as NavEdge[];
        const shown = this.graph.nodes.flatMap((node) => this.screen(node.id) || []);
        const sections = this.applications.map((app) => ({
            id: 'app-' + app.id,
            title: app.label,
            groups: [{
                id: app.id,
                title: '',
                items: shown.filter((screen) => screen.app === app.id).map((screen) => ({
                    id: screen.id,
                    title: screen.label,
                    names: [screen.id, screen.label, screen.route],
                    desc: screen.detail,
                    paths: [...screen.refs, ...navigation.filter((e) => e.from === screen.id || e.to === screen.id).flatMap((e) => e.refs)]
                        .map((r) => r.path),
                    kind: 'screen',
                })),
            }],
        }));
        const journey = this.output ? [...this.output.steps.map((step) => step.screen), ...this.involved] : [];
        return pinFirst(sections, journey, this.trace?.intent === 'review' ? 'In this review' : 'In this trace');
    }
    get matched() { return this.search.matched; }
    /** The side panel shows a screen, or the search results. */
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
    /** Escape: from a screen back to the results, else close the panel. False when nothing is open. */
    escape() {
        if (!this.search.open) return false;
        if (this.selected) this.closeDetails();
        else this.dismiss();
        return true;
    }
    /** Close the side panel: the screen and the search. */
    dismiss() {
        this.search.close();
        this.closeDetails();
    }
    /** The details panel's Close: hides it and clears the selection. Picking a screen opens it again. */
    closeDetails() {
        this.detailsOpen = false;
        this.selectedId = null;
        this.stepIndex = null;
    }
    setActionsOpen(open: boolean) { this.actionsOpen = open; }
    toggleKey() { this.keyOpen = !this.keyOpen; }
    private openStep(index: number) {
        const step = this.output!.steps[index];
        const screen = this.screen(step.screen);
        if (screen && this.appId !== screen.app) { this.resetCopy(); this.appId = screen.app; }
        this.selectedId = step.screen;
        this.stepIndex = index;
        this.detailsOpen = true;
        this.connectionTab = this.defaultTab(step.screen, this.output!.steps[index + 1]?.screen);
        this.ensureVisible(step.screen);
    }
    /** Prefer the tab holding the link to the next journey step, then any non-empty tab. */
    private defaultTab(id: string, next?: string): ConnectionTab {
        const { from, to } = this.navFor(id);
        if (next && to.some((c) => c.other === next)) return 'to';
        if (next && from.some((c) => c.other === next)) return 'from';
        return to.length || !from.length ? 'to' : 'from';
    }
    /** Widen the Show scope when a selected screen is not on the diagram. */
    private ensureVisible(id: string) {
        const shown = () => this.graph.nodes.some((node) => node.id === id);
        if (!this.output || shown()) return;
        if (this.scope === 'trace') { this.resetCopy(); this.scope = 'nearby'; }
        if (shown()) return;
        this.resetCopy();
        this.scope = 'app';
        const screen = this.screen(id);
        if (screen) this.appId = screen.app;
    }
    private isJourneyEdge(edge: SitemapNavigation) {
        if (!this.output) return true;
        const same = (e: SitemapNavigation) => e.from === edge.from && e.to === edge.to && e.label === edge.label && e.condition === edge.condition;
        return this.output.changes.navigation.some(same) || this.output.navigation.some((i) => {
            const e = this.output!.base.navigation[i];
            return !!e && same(e);
        });
    }
    /** `from`: links arriving at the screen; `to`: links leaving it. Journey links first. */
    navFor(id: string) {
        const all = (this.displayed?.navigation || []) as NavEdge[];
        const build = (incoming: boolean) => all.flatMap((edge, nav): Connection[] =>
            (incoming ? edge.to : edge.from) === id ? [{
                edge, nav, other: incoming ? edge.from : edge.to, journey: this.isJourneyEdge(edge),
                original: edge.index === undefined ? null : this.output?.base.navigation[edge.index] || null,
            }] : []).sort((a, b) => Number(b.journey) - Number(a.journey));
        return { from: build(true), to: build(false) };
    }
    screenLabel(id: string) {
        const screen = this.displayed?.screens.find((item) => item.id === id);
        const application = this.applications.find((app) => app.id === screen?.app);
        return screen ? (screen.app !== this.appId ? `${application?.label}: ` : '') + screen.label : id;
    }
    get graph() {
        const all = this.displayed?.screens || [];
        const own = new Set(all.filter((screen) => screen.app === this.appId).map((screen) => screen.id));
        const scope = this.output ? this.scope : 'app';
        const nearby = scope !== 'app';
        const edges = (this.displayed?.navigation || []).map((edge, nav) => ({ ...edge, nav })).filter((edge) => scope === 'trace'
            ? this.involved.has(edge.from) && this.involved.has(edge.to)
            : scope === 'nearby'
                ? this.involved.has(edge.from) || this.involved.has(edge.to)
                : own.has(edge.from) || own.has(edge.to));
        const visible = new Set([...(nearby ? this.involved : own), ...edges.flatMap((edge) => [edge.from, edge.to])]);
        return {
            nodes: all.filter((screen) => visible.has(screen.id)).map((screen) => ({
                ...screen, type: 'process', label: [
                    this.output?.steps.flatMap((step, i) => step.screen === screen.id ? [i + 1] : []).join(', '),
                    this.screenLabel(screen.id),
                ].filter(Boolean).join('. '),
                context: !!this.output && !this.involved.has(screen.id),
            })),
            edges: edges.map((edge) => ({ ...edge, label: [edge.label, edge.condition].filter(Boolean).join(' · ').slice(0, 60),
                context: !this.isJourneyEdge(edge),
            })),
        };
    }
    get layout() {
        if (!this.graph.nodes.length) return null;
        return fitCaptions(anchorBranchCaptions(layoutFlow(this.graph, { lanes: false })));
    }
    get svg() { return this.layout ? renderFlowSvg(this.layout, { title: 'Screens and navigation' }) : ''; }
    get exportName() { return this.trace?.title || this.repo.bootstrap?.config.name || ''; }
    get exportTitle() { return this.exportName ? `${this.exportName} — Sitemap` : 'Sitemap'; }
    private resetCopy() {
        this.copyRevision++;
        this.copy.reset();
    }
    async copyMermaid() {
        if (!this.layout || this.disposed) return;
        this.resetCopy();
        const revision = this.copyRevision;
        try {
            await this.deps.services.browser.copy(flowToMermaid(this.graph, this.exportTitle));
            if (this.disposed || revision !== this.copyRevision) return;
            this.copy.flash();
        } catch {
            if (!this.disposed && revision === this.copyRevision) runInAction(() => {
                this.message = "Couldn't copy to the clipboard.";
                this.error = true;
            });
        }
    }
    private exportSource(): ExportSource | null {
        const layout = this.layout;
        if (!layout || this.disposed) return null;
        const name = diagramFilename(this.exportName, '');
        return { svg: renderFlowSvg(layout, { title: this.exportTitle }), css: FC_CSS + SITEMAP_CSS, title: this.exportTitle,
            filename: name ? name + '-sitemap' : 'sitemap' };
    }
    exportAs(format: ExportFormat, resolve: (variable: string) => string) {
        return this.exports.run(format, resolve);
    }
    get freshnessLabel() {
        const labels: Record<string, string> = {
            missing: 'Not generated', current: 'Current at recorded commit', stale: 'Code has changed — regenerate to refresh',
            unknown: 'Recorded commit is unavailable', unrecorded: 'No commit recorded', nogit: 'Commit freshness unavailable outside Git',
        };
        return labels[this.freshness.state] || 'Freshness unknown';
    }
    /** Diagram node click: steps through repeat visits, then clears the selection. */
    pick(id: string) {
        const later = (this.output?.steps || []).some((step, i) => step.screen === id && i > (this.stepIndex ?? -1));
        this.select(id === this.selectedId && !later ? null : id);
    }
    /** Diagram and connection clicks: journey screens open their step (the next visit after the open one). */
    select(id: string | null) {
        const visits = id ? (this.output?.steps || []).flatMap((step, i) => step.screen === id ? [i] : []) : [];
        if (visits.length) {
            const current = this.stepIndex ?? -1;
            this.openStep(visits.find((i) => i > current) ?? visits[0]);
            return;
        }
        this.selectedId = id;
        this.stepIndex = null;
        if (!id) return;
        this.detailsOpen = true;
        this.connectionTab = this.defaultTab(id);
        this.ensureVisible(id);
    }
    /** Open a screen from elsewhere (the Components view), switching to its application. */
    openScreen(id: string) {
        const screen = this.screen(id);
        if (!screen) return;
        if (screen.app !== this.appId) this.selectApp(screen.app);
        this.select(id);
    }
    selectApp(id: string) {
        if (!this.applications.some((app) => app.id === id)) return;
        this.resetCopy();
        this.appId = id;
        this.selectedId = null;
        this.highlightIds = null;
        this.focus.reset();
    }
    zoom(factor: number) { this.scale = Math.max(0.15, Math.min(2.5, this.scale * factor)); }
    fit(width: number, height: number, zoom = 1) {
        if (this.layout) this.scale = Math.max(0.15, Math.min(1, (width - 24) / this.layout.width, (height - 24) / this.layout.height) * zoom);
    }
    private accept(result: SitemapResult) {
        this.resetCopy();
        this.sitemap = result.sitemap;
        this.freshness = result.status;
        if (!this.applications.some((app) => app.id === this.appId)) this.appId = this.applications[0]?.id || '';
        // Keep an open screen that is still there (e.g. opened from the Components view while this reloads).
        if (!this.trace && !this.selected) { this.selectedId = null; this.detailsOpen = false; }
    }
    async load() {
        if (this.busy || this.loading || this.disposed) return;
        const controller = new AbortController();
        this.controller = controller;
        this.loading = true;
        this.error = false;
        this.message = '';
        try {
            const result = await this.deps.services.api.get<SitemapResult>('/api/sitemap', controller.signal);
            if (!controller.signal.aborted && !this.disposed) runInAction(() => this.accept(result));
        } catch (error) {
            if (!controller.signal.aborted && !this.disposed) runInAction(() => {
                this.error = true;
                this.message = error instanceof Error ? error.message : 'Could not load sitemap.';
            });
        } finally {
            if (this.controller === controller) runInAction(() => { this.loading = false; this.controller = null; });
        }
    }
    async generate() {
        if (this.busy || this.loading || this.disposed) return;
        const controller = new AbortController();
        this.controller = controller;
        this.busy = true;
        this.error = false;
        this.message = 'Starting sitemap analysis…';
        this.log.start(this.message);
        try {
            const result = await this.deps.services.api.stream<SitemapResult>('/api/sitemap/generate', {}, controller.signal, (message) => {
                if (!controller.signal.aborted && !this.disposed) runInAction(() => { this.message = message; this.log.push(message); });
            });
            if (!result?.sitemap) throw new Error('The AI tool ended without a sitemap result.');
            if (!controller.signal.aborted && !this.disposed) runInAction(() => {
                this.accept(result);
                this.message = 'Sitemap saved.';
                this.log.push(this.message);
            });
        } catch (error) {
            if (!controller.signal.aborted && !this.disposed) runInAction(() => {
                this.error = true;
                this.message = error instanceof Error ? error.message : 'Sitemap generation failed.';
                this.log.push(this.message);
            });
            else if (controller.signal.aborted) this.log.push('Stopped.');
        } finally {
            if (this.controller === controller) runInAction(() => { this.busy = false; this.controller = null; });
        }
    }
    async generateTrace() {
        if (!this.trace || this.busy || this.loading || this.disposed || !this.repo.aiAvailable) return;
        const trace = this.trace;
        const controller = new AbortController();
        this.controller = controller;
        this.busy = true;
        this.error = false;
        this.message = 'Tracing screens and navigation…';
        const active = () => !this.disposed && !controller.signal.aborted && this.trace === trace;
        try {
            const result = await this.deps.services.api.stream<StreamResult>('/api/trace/sitemap',
                { trace: plain(trace), ...this.deps.getPick?.() }, controller.signal, (message) => {
                    if (active()) runInAction(() => { this.message = message; });
                });
            if (!active()) return;
            const output = normalizeSitemapTrace(result?.sitemap, null, trace.intent) as SitemapTrace | null;
            if (!output) throw new Error('No usable Sitemap output was returned. Retry to add it.');
            runInAction(() => {
                this.resetCopy();
                trace.sitemap = output;
                trace.outputs.sitemap = true;
                trace.pendingSitemap = false;
                if (trace.intent === 'proposal') trace.plan = null;
                this.appId = this.displayed?.screens.find((s) => this.involved.has(s.id))?.app || this.applications[0]?.id || '';
                this.selectedId = null;
                this.stepIndex = null;
                this.focus.reset();
                this.message = 'Sitemap output ready.';
            });
            await this.deps.saveTrace?.(trace);
        } catch (error) {
            if (active()) runInAction(() => {
                this.error = true;
                this.message = error instanceof Error ? error.message : 'Sitemap tracing failed. Other outputs were kept.';
            });
        } finally {
            if (this.controller === controller) runInAction(() => { this.controller = null; this.busy = false; });
        }
    }
    stop() {
        this.controller?.abort();
        this.controller = null;
        this.busy = false;
        this.loading = false;
        this.message = 'Stopped.';
    }
    dispose() { this.stop(); this.resetCopy(); this.disposed = true; }
}

export { SitemapViewModel };
export type { SitemapScope, ConnectionTab, Connection, SitemapDeps };

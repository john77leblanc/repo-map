import { makeAutoObservable, observableRef, runInAction } from 'mobx';
import { ProgressLog } from '../../models/ProgressLog';
import { CopyFeedback } from '../../models/CopyFeedback';
import type { RepositoryModel } from '../../models/RepositoryModel';
import type { AgentPick, ComponentMap, ComponentsResult, ComponentsTrace, Sitemap, StreamResult, Trace } from '../../models/types';
import { plain } from '../../models/trace';
import { composeComponentsTrace, normalizeComponentsTrace } from '../../../../lib/components-trace.mjs';
import type { Services } from '../../shared/services/contracts';
import { renderFlowSvg } from '../../../flowchart.mjs';
import { flowToMermaid } from '../../../../lib/flow.mjs';
import { DiagramExport, diagramFilename, type ExportFormat, type ExportSource } from '../../shared/diagramExport';
import { FC_CSS } from '../flowchart/styles';
import { ComponentGraphViewModel } from './ComponentGraphViewModel';

export interface ComponentsDeps {
    repo: RepositoryModel;
    services: Services;
    /** The repository sitemap: components are mapped from its screens. */
    sitemap: () => Sitemap | null;
    /** From **Used in**: the screen on the Sitemap view. */
    openScreen?: (id: string) => void;
    getPick?: () => AgentPick;
    /** Save a trace after its Components output was drawn. */
    saveTrace?: (trace: Trace) => Promise<void>;
}

/**
 * The Components view: the repository component map (components.json), its diagram and
 * generation; with a trace open, the trace's Components output drawn over its snapshot.
 */
class ComponentsViewModel {
    components: ComponentMap | null = null;
    trace: Trace | null = null;
    /** Drawing the open trace's output (not the repository map). */
    redrawing = false;
    freshness: ComponentsResult['status'] = { state: 'missing' };
    readonly graph: ComponentGraphViewModel;
    infoOpen = false;
    actionsOpen = false;
    keyOpen = false;
    loading = false;
    busy = false;
    message = '';
    error = false;
    /** Progress of the last generation, for the one-line status and its history. */
    readonly log = new ProgressLog();
    readonly copy = new CopyFeedback();
    readonly exports: DiagramExport;
    private controller: AbortController | null = null;
    private disposed = false;
    private copyRevision = 0;

    constructor(readonly deps: ComponentsDeps) {
        this.graph = new ComponentGraphViewModel({ sitemap: deps.sitemap, components: () => this.displayed, output: () => this.output,
            review: () => this.trace?.intent === 'review' });
        this.exports = new DiagramExport(deps.services, () => this.exportSource(), (message) => {
            if (!this.disposed) runInAction(() => {
                this.message = message;
                this.error = true;
            });
        });
        makeAutoObservable<this, 'controller' | 'disposed' | 'copyRevision'>(this, {
            deps: false, graph: false, copy: false, exports: false, components: observableRef, trace: observableRef, controller: false, disposed: false, copyRevision: false,
        }, { autoBind: true });
    }
    get repo() { return this.deps.repo; }
    get sitemap() { return this.deps.sitemap(); }
    /** The open trace's Components output. */
    get output(): ComponentsTrace | null { return this.trace?.components || null; }
    /** What the diagram shows: the trace's snapshot with its changes, or the repository map (none for a trace without the output). */
    get displayed(): ComponentMap | null {
        return this.output ? composeComponentsTrace(this.output) as ComponentMap : this.trace ? null : this.components;
    }
    /** A trace can draw its output once the repository map exists. */
    get canRedraw() { return !!this.trace && !!this.components && this.repo.aiAvailable; }
    /** Components are mapped from the sitemap's screens. */
    get canGenerate() { return !!this.sitemap?.screens.length; }
    get copied() { return this.copy.copied; }
    get label() {
        const map = this.components;
        if (!map) return '';
        if (map.applicability === 'none') return 'No UI components found.';
        const partial = map.applicability === 'incomplete' ? ' (incomplete)' : '';
        return `${map.components.length} components mapped${partial}.`;
    }
    get freshnessLabel() {
        const labels: Record<string, string> = {
            missing: 'Not generated', current: 'Current at recorded commit', stale: 'Code has changed — regenerate to refresh',
            unknown: 'Recorded commit is unavailable', unrecorded: 'No commit recorded', nogit: 'Commit freshness unavailable outside Git',
        };
        return labels[this.freshness.state] || 'Freshness unknown';
    }
    get exportName() { return this.trace?.title || this.repo.bootstrap?.config.name || ''; }
    get exportTitle() { return this.exportName ? `${this.exportName} — Components` : 'Components'; }
    /** Show a trace's output (or, with null, the repository map again). */
    setTrace(trace: Trace | null) {
        if (this.trace === trace) return;
        if (this.redrawing) this.stop();
        this.resetCopy();
        this.actionsOpen = false;
        if (!this.busy) { this.message = ''; this.error = false; }
        this.trace = trace;
        this.graph.resetFor(!!this.output);
    }
    toggleInfo() { this.infoOpen = !this.infoOpen; }
    setActionsOpen(open: boolean) { this.actionsOpen = open; }
    toggleKey() { this.keyOpen = !this.keyOpen; }
    openScreen(id: string) {
        this.graph.hover(null);
        this.deps.openScreen?.(id);
    }
    private resetCopy() {
        this.copyRevision++;
        this.copy.reset();
    }
    async copyMermaid() {
        if (!this.graph.layout || this.disposed) return;
        this.resetCopy();
        const revision = this.copyRevision;
        try {
            await this.deps.services.browser.copy(flowToMermaid(this.graph.graph, this.exportTitle));
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
        const layout = this.graph.layout;
        if (!layout || this.disposed) return null;
        const name = diagramFilename(this.exportName, '');
        return { svg: renderFlowSvg(layout, { title: this.exportTitle }), css: FC_CSS, title: this.exportTitle,
            filename: (name ? name + '-' : '') + 'components' };
    }
    exportAs(format: ExportFormat, resolve: (variable: string) => string) {
        return this.exports.run(format, resolve);
    }
    private accept(result: ComponentsResult | null | undefined) {
        this.resetCopy();
        this.components = result?.components ?? null;
        this.freshness = result?.status ?? { state: 'missing' };
        if (this.graph.selectedId && !this.graph.selected) this.graph.closeDetails();
    }
    async load() {
        if (this.busy || this.loading || this.disposed) return;
        this.loading = true;
        try {
            const result = await this.deps.services.api.get<ComponentsResult>('/api/components');
            if (!this.disposed) runInAction(() => this.accept(result));
        } catch (error) {
            if (!this.disposed) runInAction(() => {
                this.error = true;
                this.message = error instanceof Error ? error.message : 'Could not load components.';
            });
        } finally {
            runInAction(() => { this.loading = false; });
        }
    }
    async generate() {
        if (this.busy || this.loading || this.disposed || !this.canGenerate) return;
        const controller = new AbortController();
        this.controller = controller;
        this.busy = true;
        this.error = false;
        this.message = 'Starting component analysis…';
        this.log.start(this.message);
        try {
            const result = await this.deps.services.api.stream<ComponentsResult>('/api/components/generate', {}, controller.signal, (message) => {
                if (!controller.signal.aborted && !this.disposed) runInAction(() => { this.message = message; this.log.push(message); });
            });
            if (!result?.components) throw new Error('The AI tool ended without a component map.');
            if (!controller.signal.aborted && !this.disposed) runInAction(() => {
                this.accept(result);
                this.message = 'Component map saved.';
                this.log.push(this.message);
            });
        } catch (error) {
            if (!controller.signal.aborted && !this.disposed) runInAction(() => {
                this.error = true;
                this.message = error instanceof Error ? error.message : 'Component generation failed.';
                this.log.push(this.message);
            });
            else if (controller.signal.aborted) this.log.push('Stopped.');
        } finally {
            if (this.controller === controller) runInAction(() => { this.busy = false; this.controller = null; });
        }
    }
    /** Ask the AI tool to draw the open trace's Components output (again). */
    async generateTrace() {
        if (!this.trace || this.busy || this.loading || this.disposed || !this.canRedraw) return;
        const trace = this.trace;
        const controller = new AbortController();
        this.controller = controller;
        this.busy = true;
        this.redrawing = true;
        this.error = false;
        this.message = 'Tracing components…';
        this.log.start(this.message);
        const active = () => !this.disposed && !controller.signal.aborted && this.trace === trace;
        try {
            const result = await this.deps.services.api.stream<StreamResult>('/api/trace/components',
                { trace: plain(trace), ...this.deps.getPick?.() }, controller.signal, (message) => {
                    if (active()) runInAction(() => { this.message = message; this.log.push(message); });
                });
            if (!active()) return;
            const output = normalizeComponentsTrace(result?.components, null, trace.intent) as ComponentsTrace | null;
            if (!output) throw new Error('No usable Components output was returned. Retry to add it.');
            runInAction(() => {
                this.resetCopy();
                trace.components = output;
                trace.outputs.components = true;
                trace.pendingComponents = false;
                if (trace.intent === 'proposal') trace.plan = null;
                this.graph.resetFor(true);
                this.message = 'Components output ready.';
                this.log.push(this.message);
            });
            await this.deps.saveTrace?.(trace);
        } catch (error) {
            if (active()) runInAction(() => {
                this.error = true;
                this.message = error instanceof Error ? error.message : 'Component tracing failed. Other outputs were kept.';
                this.log.push(this.message);
            });
        } finally {
            if (this.controller === controller) runInAction(() => { this.controller = null; this.busy = false; this.redrawing = false; });
        }
    }
    stop() {
        this.controller?.abort();
        this.controller = null;
        this.busy = false;
        this.redrawing = false;
        this.message = 'Stopped.';
    }
    dispose() { this.stop(); this.resetCopy(); this.disposed = true; }
}

export { ComponentsViewModel };

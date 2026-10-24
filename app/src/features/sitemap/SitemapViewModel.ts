import { makeAutoObservable, observableRef, runInAction } from 'mobx';
import type { RepositoryModel } from '../../models/RepositoryModel';
import type { Sitemap, SitemapResult, SitemapTrace, Trace, AgentPick, StreamResult, ChangeStatus } from '../../models/types';
import { plain } from '../../models/trace';
import { normalizeSitemapTrace, composeSitemapTrace } from '../../../../lib/sitemap-trace.mjs';
import { CHANGE_LABELS } from '../../../../lib/proposal.mjs';
import type { Services } from '../../shared/services/contracts';
import { layoutFlow, renderFlowSvg } from '../../../flowchart.mjs';
import { flowToMermaid } from '../../../../lib/flow.mjs';
import { standaloneSvg, diagramFilename } from '../../shared/diagramExport';
import { FC_CSS } from '../flowchart/styles';
import { SITEMAP_CSS } from './styles';

class SitemapViewModel {
    sitemap: Sitemap | null = null;
    trace: Trace | null = null;
    wholeApplication = false;
    infoOpen = false;
    detailsOpen = true;
    actionsOpen = false;
    keyOpen = false;
    copied = false;
    stepIndex: number | null = null;
    freshness: SitemapResult['status'] = { state: 'missing' };
    appId = '';
    selectedId: string | null = null;
    scale = 1;
    loading = false;
    busy = false;
    message = '';
    error = false;
    private controller: AbortController | null = null;
    private disposed = false;
    private copyRevision = 0;
    private copyTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(readonly deps: { repo: RepositoryModel; services: Services; getPick?: () => AgentPick; saveTrace?: (trace: Trace) => Promise<void> }) {
        makeAutoObservable<this, 'controller' | 'disposed' | 'copyRevision' | 'copyTimer'>(this, {
            deps: false, sitemap: observableRef, trace: observableRef, controller: false, disposed: false,
            copyRevision: false, copyTimer: false,
        }, { autoBind: true });
    }
    get repo() { return this.deps.repo; }
    get output() { return this.trace?.sitemap; }
    get displayed(): Sitemap | null { return this.output ? composeSitemapTrace(this.output) as Sitemap : this.trace ? null : this.sitemap; }
    get applications() { return this.displayed?.applications || []; }
    get selected() { return this.displayed?.screens.find((screen) => screen.id === this.selectedId) || null; }
    get selectedChange() { return this.output?.changes.screens.find((screen) => screen.id === this.selectedId); }
    get original() { return this.output?.base.screens.find((screen) => screen.id === this.selectedId); }
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
        this.resetCopy();
        this.actionsOpen = false;
        this.message = '';
        this.error = false;
        this.trace = trace;
        this.wholeApplication = false;
        this.selectedId = null;
        this.stepIndex = null;
        this.appId = this.displayed?.screens.find((s) => this.involved.has(s.id))?.app || this.applications[0]?.id || '';
    }
    toggleContext() { this.resetCopy(); this.wholeApplication = !this.wholeApplication; }
    toggleInfo() { this.infoOpen = !this.infoOpen; }
    toggleDetails() { this.detailsOpen = !this.detailsOpen; }
    setActionsOpen(open: boolean) { this.actionsOpen = open; }
    toggleKey() { this.keyOpen = !this.keyOpen; }
    selectStep(index: number) {
        const step = this.output?.steps[index];
        if (!step) return;
        const screen = this.displayed?.screens.find((s) => s.id === step.screen);
        if (screen && this.appId !== screen.app) { this.resetCopy(); this.appId = screen.app; }
        this.selectedId = step.screen;
        this.stepIndex = index;
        this.detailsOpen = true;
    }
    get connections() {
        const visible = new Set(this.graph.nodes.map((node) => node.id));
        return (this.displayed?.navigation || []).filter((edge) =>
            (edge.from === this.selectedId || edge.to === this.selectedId) && visible.has(edge.from) && visible.has(edge.to));
    }
    screenLabel(id: string) {
        const screen = this.displayed?.screens.find((item) => item.id === id);
        const application = this.applications.find((app) => app.id === screen?.app);
        return screen ? (screen.app !== this.appId ? `${application?.label}: ` : '') + screen.label : id;
    }
    get graph() {
        const all = this.displayed?.screens || [];
        const own = new Set(all.filter((screen) => screen.app === this.appId).map((screen) => screen.id));
        const nearby = this.output && !this.wholeApplication;
        const edges = (this.displayed?.navigation || []).filter((edge) => nearby
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
                context: !!this.output && !this.output.changes.navigation.some((e) =>
                    e.from === edge.from && e.to === edge.to && e.label === edge.label && e.condition === edge.condition)
                    && !this.output.navigation.some((i) => {
                        const e = this.output!.base.navigation[i];
                        return e.from === edge.from && e.to === edge.to && e.label === edge.label && e.condition === edge.condition;
                    }),
            })),
        };
    }
    get layout() {
        if (!this.graph.nodes.length) return null;
        const layout = layoutFlow(this.graph, { lanes: false });
        // Branch captions extend away from their shared origin, rather than
        // colliding in the center between two destination screens.
        for (const edge of layout.edges) {
            if (edge.back || !edge.labelAt || layout.edges.filter((e) => e.from === edge.from && !e.back).length < 2) continue;
            const from = layout.nodes.find((n: { id: string; x: number; w: number }) => n.id === edge.from);
            const to = layout.nodes.find((n: { id: string; x: number; w: number }) => n.id === edge.to);
            if (from && to && Math.abs(from.x + from.w / 2 - to.x - to.w / 2) > 20)
                edge.labelAt[2] = to.x + to.w / 2 < from.x + from.w / 2 ? 'end' : 'start';
            const width = [CHANGE_LABELS[edge.status as ChangeStatus], edge.label].filter(Boolean).join(': ').length * 6.1 + 10;
            if (edge.labelAt[2] === 'end') edge.labelAt[0] = Math.max(width + 8, Number(edge.labelAt[0]));
            if (edge.labelAt[2] === 'start') edge.labelAt[0] = Math.max(8, Math.min(layout.width - width - 8, Number(edge.labelAt[0])));
        }
        return layout;
    }
    get svg() { return this.layout ? renderFlowSvg(this.layout, { title: 'Screens and navigation' }) : ''; }
    get exportName() { return this.trace?.title || this.repo.bootstrap?.config.name || ''; }
    get exportTitle() { return this.exportName ? `${this.exportName} — Sitemap` : 'Sitemap'; }
    private resetCopy() {
        this.copyRevision++;
        this.copied = false;
        if (this.copyTimer) clearTimeout(this.copyTimer);
        this.copyTimer = null;
    }
    async copyMermaid() {
        if (!this.layout || this.disposed) return;
        this.resetCopy();
        const revision = this.copyRevision;
        try {
            await this.deps.services.browser.copy(flowToMermaid(this.graph, this.exportTitle));
            if (this.disposed || revision !== this.copyRevision) return;
            runInAction(() => { this.copied = true; });
            this.copyTimer = setTimeout(() => runInAction(() => { this.copied = false; }), 1500);
        } catch {
            if (!this.disposed && revision === this.copyRevision) runInAction(() => {
                this.message = "Couldn't copy to the clipboard.";
                this.error = true;
            });
        }
    }
    downloadSvg(resolve: (variable: string) => string) {
        if (!this.layout || this.disposed) return;
        const svg = standaloneSvg(renderFlowSvg(this.layout, { title: this.exportTitle }), FC_CSS + SITEMAP_CSS, resolve);
        const name = diagramFilename(this.exportName, '');
        this.deps.services.browser.download((name ? name + '-sitemap' : 'sitemap') + '.svg', svg, 'image/svg+xml');
    }
    get freshnessLabel() {
        const labels: Record<string, string> = {
            missing: 'Not generated', current: 'Current at recorded commit', stale: 'Code has changed — regenerate to refresh',
            unknown: 'Recorded commit is unavailable', unrecorded: 'No commit recorded', nogit: 'Commit freshness unavailable outside Git',
        };
        return labels[this.freshness.state] || 'Freshness unknown';
    }
    select(id: string | null) {
        this.selectedId = id;
        this.stepIndex = null;
        if (id) this.detailsOpen = true;
    }
    selectApp(id: string) {
        if (!this.applications.some((app) => app.id === id)) return;
        this.resetCopy();
        this.appId = id;
        this.selectedId = null;
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
        if (!this.trace) this.selectedId = null;
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
        try {
            const result = await this.deps.services.api.stream<SitemapResult>('/api/sitemap/generate', {}, controller.signal, (message) => {
                if (!controller.signal.aborted && !this.disposed) runInAction(() => { this.message = message; });
            });
            if (!result?.sitemap) throw new Error('The AI tool ended without a sitemap result.');
            if (!controller.signal.aborted && !this.disposed) runInAction(() => {
                this.accept(result);
                this.message = 'Sitemap saved.';
            });
        } catch (error) {
            if (!controller.signal.aborted && !this.disposed) runInAction(() => {
                this.error = true;
                this.message = error instanceof Error ? error.message : 'Sitemap generation failed.';
            });
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

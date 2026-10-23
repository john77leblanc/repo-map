import { makeAutoObservable, observable, isObservable, observableRef, runInAction } from 'mobx';
import type { RepositoryModel } from '../../models/RepositoryModel';
import type { AgentPick, Flow, Trace, StreamResult } from '../../models/types';
import type { Services } from '../../shared/services/contracts';
import { layoutFlow, renderFlowSvg } from '../../../flowchart.mjs';
import { normalizeFlow, flowToMermaid } from '../../../../lib/flow.mjs';
import { traceOutputs } from '../../../../lib/trace-outputs.mjs';
import { FC_CSS } from './styles';

export interface FlowchartDeps {
    repo: RepositoryModel;
    services: Services;
    getPick: () => AgentPick;
    saveTrace: (trace: Trace) => Promise<unknown>;
    onTraceUpdated: (trace: Trace) => void;
    onNodeSelected?: (id: string | null) => void;
}
export class FlowchartViewModel {
    trace: Trace | null = null;
    selectedId: string | null = null;
    scale = 1;
    keyOpen = false;
    busy = false;
    status = '';
    error = false;
    copied = false;
    private controller: AbortController | null = null;
    private revision = 0;
    private disposed = false;
    private copyTimer: ReturnType<typeof setTimeout> | null = null;
    constructor(readonly deps: FlowchartDeps) {
        makeAutoObservable<
            FlowchartViewModel,
            'controller' | 'revision' | 'disposed' | 'copyTimer'
        >(
            this,
            {
                deps: false,
                trace: observableRef,
                controller: false,
                revision: false,
                disposed: false,
                copyTimer: false,
            },
            { autoBind: true }
        );
    }
    get repo() {
        return this.deps.repo;
    }
    get layout() {
        return this.trace?.flow ? layoutFlow(this.trace.flow) : null;
    }
    get svg() {
        return this.layout ? renderFlowSvg(this.layout, { title: this.trace?.title }) : '';
    }
    get selected() {
        return this.trace?.flow?.nodes.find((node) => node.id === this.selectedId) || null;
    }
    get references() {
        const step = this.selected?.step;
        const id = step ? this.trace?.steps[step - 1]?.id : null;
        return id
            ? [
                  ...(this.trace?.refs || []).filter((ref) => ref.step === id),
                  ...(this.repo.docs[id] || []),
              ]
            : [];
    }
    get inferred() {
        return (
            (this.trace?.flow?.nodes.filter((n) => n.inferred).length || 0) +
            (this.trace?.flow?.edges.filter((e) => e.inferred).length || 0)
        );
    }
    setTrace(trace: Trace | null) {
        this.stop(false);
        this.trace = trace ? (isObservable(trace) ? trace : observable(trace)) : null;
        this.copied = false;
        this.selectedId = null;
        this.status = '';
        this.error = false;
    }
    select(id: string | null) {
        this.selectedId = id;
        this.deps.onNodeSelected?.(id);
    }
    toggleKey() {
        this.keyOpen = !this.keyOpen;
    }
    setScale(scale: number) {
        this.scale = Math.max(0.3, Math.min(2.5, scale));
    }
    zoom(factor: number) {
        this.setScale(this.scale * factor);
    }
    fit(width: number, height: number, zoom = 1) {
        if (this.layout)
            this.setScale(
                Math.max(
                    0.65,
                    Math.min(
                        1,
                        (width - 24) / this.layout.width,
                        (height - 92) / this.layout.height
                    )
                ) * zoom
            );
    }
    stop(showStatus = true) {
        this.revision++;
        this.controller?.abort();
        this.controller = null;
        if (this.busy && showStatus) {
            this.status = 'Stopped.';
            this.error = true;
        }
        this.busy = false;
    }
    async generate(trace: Trace) {
        if (this.disposed || this.busy) return;
        this.setTrace(trace);
        trace = this.trace!;
        const controller = new AbortController();
        const revision = ++this.revision;
        const current = () =>
            !this.disposed && this.revision === revision && !controller.signal.aborted;
        this.controller = controller;
        this.busy = true;
        this.status = 'Starting…';
        const started = Date.now();
        let progress = this.status;
        const tick = () => {
            if (current())
                runInAction(() => {
                    this.status = `${progress} · ${Math.round((Date.now() - started) / 1000)}s`;
                });
        };
        const timer = setInterval(tick, 1000);
        try {
            const result = await this.deps.services.api.stream<StreamResult>(
                '/api/flow',
                { trace, ...this.deps.getPick() },
                controller.signal,
                (text) => {
                    progress = text;
                    tick();
                }
            );
            if (!current()) return;
            const flow = normalizeFlow(result.flow, trace.steps.length) as Flow | null;
            if (!flow) throw new Error('The AI tool ended without a usable flowchart.');
            const updated = observable<Trace>({
                ...trace,
                flow,
                pendingFlow: false,
                outputs: { ...traceOutputs(trace), flowchart: true },
            });
            runInAction(() => {
                this.trace = updated;
                this.selectedId = null;
                this.status = '';
            });
            await this.deps.saveTrace(updated);
            if (current())
                runInAction(() => {
                    this.deps.onTraceUpdated(updated);
                });
        } catch (error) {
            if (current())
                runInAction(() => {
                    this.error = true;
                    this.status = error instanceof Error ? error.message : String(error);
                });
        } finally {
            clearInterval(timer);
            if (current())
                runInAction(() => {
                    this.busy = false;
                    this.controller = null;
                });
        }
    }
    async copyMermaid() {
        if (!this.trace?.flow || this.disposed) return;
        const revision = this.revision;
        try {
            await this.deps.services.browser.copy(flowToMermaid(this.trace.flow, this.trace.title));
            if (this.disposed || revision !== this.revision) return;
            runInAction(() => {
                this.copied = true;
            });
            if (this.copyTimer) clearTimeout(this.copyTimer);
            this.copyTimer = setTimeout(
                () =>
                    runInAction(() => {
                        this.copied = false;
                    }),
                1500
            );
        } catch {
            if (!this.disposed && revision === this.revision)
                runInAction(() => {
                    this.status = "Couldn't copy to the clipboard.";
                    this.error = true;
                });
        }
    }
    downloadSvg(resolve: (variable: string) => string) {
        if (!this.layout || !this.trace) return;
        const css = FC_CSS.replace(/var\((--[\w-]+)\)/g, (_: string, variable: string) =>
            resolve(variable)
        );
        const bg = resolve('--bg').replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
        const svg = this.svg.replace(
            /^<svg([^>]*)>/,
            `<svg$1><style>${css.replace(/</g, '&lt;')}</style><rect width="100%" height="100%" fill="${bg}"/>`
        );
        const name = (this.trace.title || 'flowchart')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
        this.deps.services.browser.download(name + '.svg', svg, 'image/svg+xml');
    }
    dispose() {
        this.stop(false);
        this.disposed = true;
        if (this.copyTimer) clearTimeout(this.copyTimer);
    }
}

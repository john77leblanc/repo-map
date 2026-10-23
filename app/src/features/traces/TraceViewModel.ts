import { makeAutoObservable, observable, observableRef, isObservable, runInAction } from 'mobx';
import type { RepositoryModel } from '../../models/RepositoryModel';
import type { Services } from '../../shared/services/contracts';
import type { AgentPick, StreamResult, Trace, Workspace } from '../../models/types';
import { decodeTrace, encodeTrace, normalizeTrace, plain, spend } from '../../models/trace';

export interface TraceDependencies {
    repo: RepositoryModel;
    services: Services;
    getPick(): AgentPick;
    getPickLabel(): string;
    getWorkspace(): Workspace;
    onSelect(trace: Trace, workspace: Workspace): void;
    onClear(): void;
    onReveal(nodeId: string): void;
    onOpenPlan(trace: Trace): void;
    onRequestFlow(trace: Trace): void | Promise<void>;
}
export class TraceViewModel {
    selected: Trace | null = null;
    items: Trace[] = [];
    temp: Trace | null = null;
    ready = false;
    composerOpen = false;
    prompt = '';
    architecture = true;
    flowchart = true;
    status = '';
    error = false;
    busy = false;
    importCode = '';
    importMessage = '';
    code = '';
    storeNote =
        'Saved automatically to .repo-map/traces on this machine (git-ignored). Open an output to explore it.';
    private controllers = new Set<AbortController>();
    private generation: AbortController | null = null;
    private ticker: ReturnType<typeof setInterval> | null = null;
    private disposed = false;
    private loadVersion = 0;
    private selectionVersion = 0;
    constructor(readonly deps: TraceDependencies) {
        makeAutoObservable<
            this,
            | 'controllers'
            | 'generation'
            | 'ticker'
            | 'disposed'
            | 'loadVersion'
            | 'selectionVersion'
        >(
            this,
            {
                deps: false,
                selected: observableRef,
                temp: observableRef,
                controllers: false,
                generation: false,
                ticker: false,
                disposed: false,
                loadVersion: false,
                selectionVersion: false,
            },
            { autoBind: true }
        );
    }
    get repo() {
        return this.deps.repo;
    }
    get workspace() {
        return this.deps.getWorkspace();
    }
    get rows() {
        return this.temp
            ? [this.temp, ...this.items.filter((t) => t.key !== this.temp?._doc)]
            : this.items;
    }
    setPrompt(value: string) {
        this.prompt = value;
    }
    setOutput(output: 'architecture' | 'flowchart', value: boolean) {
        this[output] = value;
        try {
            this.deps.services.storage.setRaw(
                this.repo.namespace + (output === 'architecture' ? 'witharchitecture' : 'withflow'),
                value ? '1' : '0'
            );
        } catch {
            /* Preferences are optional when storage is unavailable. */
        }
    }
    setImportCode(value: string) {
        this.importCode = value;
    }
    toggleComposer() {
        if (this.selected) this.clear();
        this.composerOpen = !this.composerOpen;
    }
    setStatus(text: string, error = false) {
        this.status = text;
        this.error = error;
        if (error) this.composerOpen = true;
    }
    init() {
        for (const output of ['architecture', 'flowchart'] as const) {
            try {
                const value = this.deps.services.storage.getRaw(
                    this.repo.namespace +
                        (output === 'architecture' ? 'witharchitecture' : 'withflow')
                );
                if (value !== null) this[output] = value === '1';
            } catch {
                /* Keep defaults. */
            }
        }
        return this.loadSaved();
    }
    async loadSaved() {
        const version = ++this.loadVersion,
            ctl = new AbortController();
        this.controllers.add(ctl);
        try {
            const result = await this.deps.services.api.get<{ traces: Trace[] }>(
                '/api/traces',
                ctl.signal
            );
            if (this.disposed || ctl.signal.aborted || version !== this.loadVersion) return;
            runInAction(() => {
                this.items = result.traces || [];
                this.ready = true;
            });
        } catch {
            if (!this.disposed && !ctl.signal.aborted && version === this.loadVersion)
                runInAction(() => {
                    this.storeNote = "Couldn't read saved traces from disk.";
                });
        } finally {
            this.controllers.delete(ctl);
        }
    }
    select(trace: Trace, workspace: Workspace = this.workspace) {
        if (this.disposed) return;
        this.selectionVersion++;
        this.selected = isObservable(trace) ? trace : observable(trace);
        this.deps.onSelect(this.selected, workspace);
    }
    clear() {
        this.selectionVersion++;
        this.selected = null;
        this.code = '';
        this.deps.onClear();
    }
    reveal(id: string) {
        this.deps.onReveal(id);
    }
    openPlan(trace: Trace) {
        this.deps.onOpenPlan(trace);
    }
    async openSavedOutput(item: Trace, output: Workspace) {
        let trace: Trace;
        try {
            trace =
                item === this.temp || item === this.selected
                    ? item
                    : Object.assign(normalizeTrace(item, this.repo.map), {
                          _doc: item.key || item._doc,
                          createdAt: item.createdAt,
                      });
        } catch {
            this.setStatus('That trace refers to nodes that are no longer on the map.', true);
            return;
        }
        trace = isObservable(trace) ? trace : observable(trace);
        const selectionVersion = ++this.selectionVersion;
        if (output === 'flowchart') {
            if (!trace.flow && !trace.pendingFlow) {
                if (this.repo.aiAvailable) await this.deps.onRequestFlow(trace);
                return;
            }
        } else if (!trace.outputs.architecture) {
            runInAction(() => {
                trace.outputs.architecture = true;
            });
            await this.saveExisting(trace);
        }
        if (!this.disposed && selectionVersion === this.selectionVersion)
            this.select(trace, output);
    }
    openOutput(output: Workspace) {
        if (this.selected) return this.openSavedOutput(this.selected, output);
    }
    async persist(trace: Trace): Promise<boolean> {
        const ctl = new AbortController();
        this.controllers.add(ctl);
        runInAction(() => {
            trace.createdAt ||= Date.now();
        });
        try {
            const result = await this.deps.services.api.request<{ key?: string }>(
                '/api/traces' + (trace._doc ? '/' + encodeURIComponent(trace._doc) : ''),
                {
                    method: trace._doc ? 'PUT' : 'POST',
                    signal: ctl.signal,
                    body: JSON.stringify({ ...plain(trace), createdAt: trace.createdAt }),
                }
            );
            if (this.disposed || ctl.signal.aborted) return false;
            runInAction(() => {
                if (result?.key) trace._doc = result.key;
                if (this.temp === trace) this.temp = null;
            });
            await this.loadSaved();
            return !this.disposed;
        } catch {
            if (!this.disposed && !ctl.signal.aborted)
                runInAction(() => {
                    this.temp = trace;
                    this.setStatus(
                        'Changes could not be saved. Retry saving before reloading.',
                        true
                    );
                });
            return false;
        } finally {
            this.controllers.delete(ctl);
        }
    }
    async saveExisting(trace: Trace) {
        await this.persist(trace);
    }
    async keepTrace(trace: Trace, preferred: Workspace = this.workspace) {
        const selectionVersion = ++this.selectionVersion;
        trace = isObservable(trace) ? trace : observable(trace);
        await this.persist(trace);
        if (!this.disposed && selectionVersion === this.selectionVersion)
            this.select(
                trace,
                (trace.outputs.flowchart || trace.pendingFlow) &&
                    (preferred === 'flowchart' || !trace.outputs.architecture)
                    ? 'flowchart'
                    : 'architecture'
            );
    }
    async importTrace() {
        let trace: Trace;
        try {
            trace = decodeTrace(this.importCode, this.repo.map);
        } catch {
            this.importMessage = "That isn't a valid trace code.";
            return;
        }
        this.importCode = '';
        this.importMessage = '';
        await this.keepTrace(trace);
    }
    async copyCode(trace: Trace) {
        const code = encodeTrace(trace);
        try {
            await this.deps.services.browser.copy(code);
            if (!this.disposed)
                runInAction(() => {
                    this.setStatus('Copied.');
                });
        } catch {
            if (!this.disposed)
                runInAction(() => {
                    this.code = code;
                });
        }
    }
    async removeTrace(trace: Trace) {
        if (!trace._doc) return;
        const ctl = new AbortController();
        this.controllers.add(ctl);
        try {
            await this.deps.services.api.request('/api/traces/' + encodeURIComponent(trace._doc), {
                method: 'DELETE',
                signal: ctl.signal,
            });
            if (this.disposed || ctl.signal.aborted) return;
            runInAction(() => {
                if (this.temp?._doc === trace._doc) this.temp = null;
                if (this.selected?._doc === trace._doc) this.clear();
            });
            await this.loadSaved();
        } catch {
            if (!this.disposed && !ctl.signal.aborted)
                runInAction(() => this.setStatus("Couldn't delete that trace.", true));
        } finally {
            this.controllers.delete(ctl);
        }
    }
    stop() {
        this.generation?.abort();
        if (this.ticker !== null) clearInterval(this.ticker);
        this.ticker = null;
    }
    async runTrace() {
        const prompt = this.prompt.trim();
        if (!prompt || this.busy || !this.repo.aiAvailable || this.disposed) return;
        const outputs = { architecture: this.architecture, flowchart: this.flowchart },
            origin = this.workspace;
        if (!outputs.architecture && !outputs.flowchart) {
            this.setStatus('Select Code architecture, Flowchart, or both.', true);
            return;
        }
        const ctl = new AbortController();
        this.generation = ctl;
        this.controllers.add(ctl);
        this.busy = true;
        let answered = false;
        const start = Date.now();
        let last = 'Starting ' + this.deps.getPickLabel() + '…';
        const tick = () => {
            if (!answered && !this.disposed && !ctl.signal.aborted)
                runInAction(() =>
                    this.setStatus(last + ' · ' + Math.round((Date.now() - start) / 1000) + 's')
                );
        };
        tick();
        const timer = setInterval(tick, 1000);
        this.ticker = timer;
        try {
            const result = await this.deps.services.api.stream<StreamResult>(
                '/api/trace',
                { prompt, flow: outputs.flowchart, ...this.deps.getPick() },
                ctl.signal,
                (text) => {
                    last = text;
                    tick();
                }
            );
            answered = true;
            clearInterval(timer);
            if (this.ticker === timer) this.ticker = null;
            if (this.disposed || ctl.signal.aborted) return;
            if (!result)
                throw new Error(
                    this.deps.getPickLabel() +
                        ' ended without an answer. Run repo-map doctor to check your setup.'
                );
            const trace = normalizeTrace(
                { ...(result.trace as object), outputs, used: result.used },
                this.repo.map,
                prompt
            );
            trace.outputs = {
                architecture: outputs.architecture,
                flowchart: outputs.flowchart && !!trace.flow,
            };
            trace.pendingFlow = outputs.flowchart && !trace.flow;
            runInAction(() =>
                this.setStatus(
                    'Done in ' + Math.round((Date.now() - start) / 1000) + 's' + spend(result)
                )
            );
            await this.keepTrace(trace, origin);
            if (!this.disposed && !ctl.signal.aborted)
                runInAction(() => {
                    this.prompt = '';
                    if (trace.pendingFlow)
                        this.setStatus(
                            'The walkthrough was kept, but the flowchart was missing. Open the flowchart output to retry.',
                            true
                        );
                });
        } catch (error) {
            if (!this.disposed)
                runInAction(() =>
                    this.setStatus(
                        ctl.signal.aborted
                            ? 'Stopped.'
                            : error instanceof Error && error.message !== 'no known services'
                              ? error.message
                              : "The answer didn't name any services on this map. Try rephrasing.",
                        !ctl.signal.aborted
                    )
                );
        } finally {
            clearInterval(timer);
            if (this.ticker === timer) this.ticker = null;
            this.controllers.delete(ctl);
            if (!this.disposed)
                runInAction(() => {
                    this.busy = false;
                    this.generation = null;
                    if (ctl.signal.aborted) this.setStatus('Stopped.');
                });
        }
    }
    dispose() {
        this.disposed = true;
        this.stop();
        this.controllers.forEach((ctl) => ctl.abort());
        this.controllers.clear();
    }
}

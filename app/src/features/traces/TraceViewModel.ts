import { makeAutoObservable, observable, observableRef, isObservable, runInAction } from 'mobx';
import type { RepositoryModel } from '../../models/RepositoryModel';
import type { Services } from '../../shared/services/contracts';
import type { AgentPick, StreamResult, Trace, Workspace } from '../../models/types';
import { decodeTrace, encodeTrace, linkOf, normalizeTrace, plain, spend } from '../../models/trace';
import type { WorkspaceMap } from '../../models/trace';
import { TraceJob } from './TraceJob';
import { countInferred } from '../../../../lib/flow.mjs';
import type { SitemapViewModel } from '../sitemap/SitemapViewModel';

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
    isPlanBusy?(trace: Trace): boolean;
    onRequestFlow(trace: Trace): void | Promise<void>;
    sitemap?: SitemapViewModel;
    /** The map scope: new traces follow the workspace when it is shown. */
    getScope?(): 'repo' | 'workspace';
    /** The workspace's merged map, once loaded. */
    getWorkspaceMap?(): WorkspaceMap | null;
    /** Titles of linked repos by name. */
    getRepoTitles?(): Record<string, string>;
    /** Resolves once the workspace has loaded (or failed to), so workspace traces read the merged map. */
    workspaceReady?(): Promise<void>;
}
export class TraceViewModel {
    selected: Trace | null = null;
    editing: Trace | null = null;
    private editDefaults: { prompt: string; architecture: boolean; flowchart: boolean; sitemap: boolean } | null = null;
    private editWorkspace: Workspace = 'architecture';
    savingRevision = false;
    private editDraft: { id: string; prompt: string; architecture: boolean; flowchart: boolean; sitemap: boolean } | null = null;
    jobs: TraceJob[] = [];
    activeJob: TraceJob | null = null;
    private jobDefaults: { prompt: string; architecture: boolean; flowchart: boolean; sitemap: boolean } | null = null;
    items: Trace[] = [];
    temp: Trace | null = null;
    ready = false;
    composerOpen = false;
    prompt = '';
    architecture = true;
    flowchart = true;
    sitemap = false;
    private message = '';
    private statusError = false;
    private revisionBusy = false;
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
                editing: observableRef,
                activeJob: observableRef,
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
    /** Ask for a workspace trace? Only while the map shows the workspace. */
    private get scopeBody(): { scope?: 'workspace' } {
        return this.deps.getScope?.() === 'workspace' ? { scope: 'workspace' } : {};
    }
    private normalize(raw: unknown, prompt?: string) {
        return normalizeTrace(raw, this.repo.map, prompt, this.deps.getWorkspaceMap?.() || null);
    }
    /** A step's card title; a step in a repo that is no longer linked says so. */
    stepTitle(trace: Trace, id: string) {
        const map = trace.scope ? this.deps.getWorkspaceMap?.() : null;
        const node = (map || this.repo.map).nodes.find((n) => n.id === id);
        const link = linkOf(id);
        if (node) {
            const repo = link ? this.deps.getRepoTitles?.()[link] || link : '';
            return (node.title || id) + (repo ? ` (${repo})` : '');
        }
        const change = trace.proposal?.nodes.find((n) => n.id === id);
        if (change) return change.title || id;
        return link ? `${id.slice(link.length + 1)} (from ${link}, not linked)` : id;
    }
    /** Steps whose repo is no longer linked. */
    unlinkedRepos(trace: Trace) {
        if (!trace.scope) return [];
        const map = this.deps.getWorkspaceMap?.();
        const present = new Set((map?.nodes || []).map((n) => linkOf(n.id)));
        return [...new Set(trace.steps.map((s) => linkOf(s.id)).filter((l) => l && !present.has(l)))];
    }
    get workspace() {
        return this.deps.getWorkspace();
    }
    get busy() {
        return this.editing ? this.revisionBusy : !!this.activeJob?.busy;
    }
    get status() {
        return !this.editing && this.activeJob ? this.activeJob.status : this.message;
    }
    get error() {
        return !this.editing && this.activeJob ? this.activeJob.error : this.statusError;
    }
    get saving() {
        return this.savingRevision || this.activeJob?.state === 'saving';
    }
    get jobRows() {
        return this.jobs.filter((job) => !job.result || (job.result !== this.temp &&
            !this.items.some((item) => !!job.result?._doc && item.key === job.result._doc)));
    }
    private outputsFor(trace: Trace): Workspace[] {
        const outputs: Workspace[] = [];
        if (trace.outputs.architecture && trace.steps.length) outputs.push('architecture');
        if (trace.outputs.flowchart && trace.flow) outputs.push('flowchart');
        if (trace.outputs.sitemap && trace.sitemap) outputs.push('sitemap');
        return outputs;
    }
    /** Inferred nodes and edges in the selected trace's flowchart. */
    get flowInferred(): number {
        return countInferred(this.selected?.flow);
    }
    get availableOutputs() {
        return this.selected ? this.outputsFor(this.selected) : [];
    }
    get rows() {
        return this.temp
            ? [this.temp, ...this.items.filter((t) => t.key !== this.temp?._doc)]
            : this.items;
    }
    setPrompt(value: string) {
        this.prompt = value;
    }
    setOutput(output: Workspace, value: boolean) {
        this[output] = value;
        if (this.editing || this.activeJob) return;
        try {
            this.deps.services.storage.setRaw(
                this.repo.namespace + (output === 'architecture' ? 'witharchitecture' : output === 'sitemap' ? 'withsitemap' : 'withflow'),
                value ? '1' : '0'
            );
        } catch {
            /* Preferences are optional when storage is unavailable. */
        }
        if (output === 'sitemap' && value) void this.deps.sitemap?.load();
    }
    setImportCode(value: string) {
        this.importCode = value;
    }
    editPrompt(trace: Trace) {
        if (this.busy || this.editing || this.disposed || !trace._doc) return;
        this.editDefaults = { prompt: this.prompt, architecture: this.architecture, flowchart: this.flowchart, sitemap: this.sitemap };
        this.editWorkspace = this.workspace;
        this.clear(); // Disconnect output views and cancel their active jobs.
        this.editing = trace;
        this.selected = isObservable(trace) ? trace : observable(trace);
        this.prompt = trace.prompt;
        this.architecture = trace.outputs.architecture;
        this.flowchart = trace.outputs.flowchart || trace.pendingFlow;
        this.sitemap = !!(trace.outputs.sitemap || trace.pendingSitemap);
        if (this.editDraft?.id === trace._doc) {
            this.prompt = this.editDraft.prompt;
            this.architecture = this.editDraft.architecture;
            this.flowchart = this.editDraft.flowchart;
            this.sitemap = this.editDraft.sitemap;
        }
        this.message = '';
        this.statusError = false;
        this.composerOpen = true;
    }
    private finishEdit() {
        if (this.editDefaults) Object.assign(this, this.editDefaults);
        this.editDefaults = null;
        this.editing = null;
        this.composerOpen = false;
    }
    cancelEdit() {
        if (!this.editing || this.savingRevision) return;
        const original = this.editing;
        this.editDraft = { id: original._doc!, prompt: this.prompt, architecture: this.architecture, flowchart: this.flowchart, sitemap: this.sitemap };
        this.stop();
        this.finishEdit();
        this.select(original, this.editWorkspace);
    }
    closeComposer() {
        if (this.editing) return;
        this.releaseJob();
        this.composerOpen = false;
    }
    toggleComposer() {
        if (this.editing) return;
        if (this.composerOpen) { this.closeComposer(); return; }
        if (this.selected) this.clear();
        this.message = '';
        this.statusError = false;
        this.composerOpen = true;
    }
    private releaseJob() {
        if (!this.activeJob) return;
        this.message = this.activeJob.status;
        this.statusError = this.activeJob.error;
        if (this.jobDefaults) Object.assign(this, this.jobDefaults);
        this.jobDefaults = null;
        this.activeJob = null;
    }
    openJob(job: TraceJob) {
        if (this.disposed || this.editing) return;
        if (job.result && !job.busy) {
            if (job.saveFailed) this.temp = job.result;
            this.message = job.status;
            this.statusError = job.error;
            return this.openSavedOutput(job.result, this.resultWorkspace(job.result, job.workspace));
        }
        this.releaseJob();
        this.jobDefaults = { prompt: this.prompt, architecture: this.architecture, flowchart: this.flowchart, sitemap: this.sitemap };
        this.clear();
        this.activeJob = job;
        this.prompt = job.prompt;
        Object.assign(this, job.outputs, { sitemap: !!job.outputs.sitemap });
        this.composerOpen = true;
    }
    setStatus(text: string, error = false) {
        this.message = text;
        this.statusError = error;
        if (error) this.composerOpen = true;
    }
    init() {
        for (const output of ['architecture', 'flowchart', 'sitemap'] as const) {
            try {
                const value = this.deps.services.storage.getRaw(
                    this.repo.namespace +
                        (output === 'architecture' ? 'witharchitecture' : output === 'sitemap' ? 'withsitemap' : 'withflow')
                );
                if (value !== null) this[output] = value === '1';
            } catch {
                /* Keep defaults. */
            }
        }
        if (this.sitemap) void this.deps.sitemap?.load();
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
        this.releaseJob();
        this.selected = isObservable(trace) ? trace : observable(trace);
        if (!this.editing) this.composerOpen = false;
        this.deps.onSelect(this.selected, workspace);
    }
    clear() {
        this.releaseJob();
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
    get planBusy() {
        return !!this.selected && !!this.deps.isPlanBusy?.(this.selected);
    }
    async openSavedOutput(item: Trace, output: Workspace) {
        if (this.editing) return;
        if (item.scope === 'workspace' && item !== this.temp && item !== this.selected && this.deps.workspaceReady) {
            await this.deps.workspaceReady();
            if (this.disposed || this.editing) return;
        }
        let trace: Trace;
        try {
            trace =
                item === this.temp || item === this.selected
                    ? item
                    : Object.assign(this.normalize(item), {
                          _doc: item.key || item._doc,
                          createdAt: item.createdAt,
                      });
        } catch {
            this.setStatus('That trace refers to nodes that are no longer on the map.', true);
            return;
        }
        trace = isObservable(trace) ? trace : observable(trace);
        const selectionVersion = ++this.selectionVersion;
        if (output === 'sitemap') {
            this.select(trace, output);
            return;
        } else if (output === 'flowchart') {
            if (!trace.flow && !trace.pendingFlow) {
                if (this.repo.aiAvailable) await this.deps.onRequestFlow(trace);
                return;
            }
        } else if (!trace.outputs.architecture && trace.steps.length) {
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
    async persist(trace: Trace, quiet = false): Promise<boolean> {
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
            if (!quiet && !this.disposed && !ctl.signal.aborted)
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
        const saved = await this.persist(trace);
        if (saved) runInAction(() => {
            for (const job of this.jobs) if (job.result === trace) {
                job.saveFailed = false;
                job.error = false;
            }
        });
    }
    private resultWorkspace(trace: Trace, preferred: Workspace): Workspace {
        const available = this.outputsFor(trace);
        if (available.length) return available.includes(preferred) ? preferred : available[0];
        return (trace.outputs.sitemap || trace.pendingSitemap) && (preferred === 'sitemap' || (!trace.outputs.architecture && !trace.outputs.flowchart && !trace.pendingFlow))
            ? 'sitemap' : (trace.outputs.flowchart || trace.pendingFlow) && (preferred === 'flowchart' || !trace.outputs.architecture) ? 'flowchart' : 'architecture';
    }
    async keepTrace(trace: Trace, preferred: Workspace = this.workspace) {
        const selectionVersion = ++this.selectionVersion;
        trace = isObservable(trace) ? trace : observable(trace);
        await this.persist(trace);
        if (!this.disposed && selectionVersion === this.selectionVersion)
            this.select(
                trace,
                this.resultWorkspace(trace, preferred)
            );
    }
    async importTrace() {
        await this.deps.workspaceReady?.();
        let trace: Trace;
        try {
            trace = decodeTrace(this.importCode, this.repo.map, this.deps.getWorkspaceMap?.() || null);
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
                this.jobs = this.jobs.filter((job) => job.result?._doc !== trace._doc);
            });
            await this.loadSaved();
        } catch {
            if (!this.disposed && !ctl.signal.aborted)
                runInAction(() => this.setStatus("Couldn't delete that trace.", true));
        } finally {
            this.controllers.delete(ctl);
        }
    }
    private async runNewTrace(prompt: string) {
        const outputs = { architecture: this.architecture, flowchart: this.flowchart, ...(this.sitemap ? { sitemap: true } : {}) };
        if (!outputs.architecture && !outputs.flowchart && !outputs.sitemap) {
            this.setStatus('Select Code architecture, Flowchart, or Sitemap.', true);
            return;
        }
        if (!this.activeJob) this.jobDefaults = { prompt: '', architecture: this.architecture, flowchart: this.flowchart, sitemap: this.sitemap };
        else this.jobs = this.jobs.filter((job) => job !== this.activeJob);
        const job = new TraceJob(prompt, outputs, { ...this.deps.getPick() }, this.deps.getPickLabel(), this.workspace);
        this.jobs.unshift(job);
        this.activeJob = job;
        const signal = job.controller.signal;
        this.controllers.add(job.controller);
        const current = () => !this.disposed && !signal.aborted;
        let last = 'Starting ' + job.agentLabel + '...';
        const tick = () => {
            if (current() && job.state === 'running') runInAction(() => {
                job.status = last + ' - ' + Math.round((Date.now() - job.createdAt) / 1000) + 's';
            });
        };
        tick();
        job.ticker = setInterval(tick, 1000);
        try {
            if (outputs.sitemap && !this.deps.sitemap?.sitemap) {
                await this.deps.sitemap?.load();
                if (!current()) return;
                if (!this.deps.sitemap?.sitemap) throw new Error('Generate the repository sitemap before tracing screens. Your question has been kept.');
            }
            const result = await this.deps.services.api.stream<StreamResult>('/api/trace',
                { prompt, flow: outputs.flowchart, ...(outputs.sitemap ? { sitemap: true, architecture: outputs.architecture } : {}), ...this.scopeBody, ...job.pick },
                signal, (text) => { last = text; tick(); },
                (title) => { if (current() && job.state === 'running') runInAction(() => { job.title = title.trim().slice(0, 80); }); });
            if (!current()) return;
            job.clearTicker();
            if (!result) throw new Error(job.agentLabel + ' ended without an answer. Run repo-map doctor to check your setup.');
            const trace = observable(this.normalize({ ...(result.trace as object), outputs, used: result.used }, prompt));
            trace.createdAt = job.createdAt;
            trace.outputs = {
                architecture: outputs.architecture && trace.steps.length > 0,
                flowchart: outputs.flowchart && !!trace.flow,
                ...(outputs.sitemap ? { sitemap: !!trace.sitemap } : {}),
            };
            trace.pendingFlow = outputs.flowchart && !trace.flow;
            trace.pendingSitemap = !!outputs.sitemap && !trace.sitemap;
            runInAction(() => {
                job.result = trace;
                job.title = trace.title;
                job.state = 'saving';
                job.status = 'Done in ' + Math.round((Date.now() - job.createdAt) / 1000) + 's' + spend(result);
            });
            const saved = await this.persist(trace, true);
            if (this.disposed) return;
            runInAction(() => {
                job.state = 'completed';
                job.saveFailed = !saved;
                if (!saved) {
                    job.status = 'Changes could not be saved. Open the trace to retry saving before reloading.';
                    job.error = true;
                } else if (trace.pendingFlow || trace.pendingSitemap) {
                    job.status = trace.pendingSitemap
                        ? 'Other outputs were kept, but Sitemap was missing. Use Edit to select Sitemap and regenerate.'
                        : 'The walkthrough was kept, but the flowchart was missing. Use Edit to retry the requested outputs.';
                    job.error = true;
                }
                if (this.activeJob === job) {
                    if (!saved) this.temp = trace;
                    this.select(trace, this.resultWorkspace(trace, job.workspace));
                }
            });
        } catch (error) {
            if (!this.disposed) runInAction(() => {
                job.state = signal.aborted ? 'stopped' : 'failed';
                job.status = signal.aborted ? 'Stopped.' : error instanceof Error && error.message !== 'no known services'
                    ? error.message : 'The AI returned no usable trace outputs. Your question was kept; try again.';
                job.error = !signal.aborted;
                job.title ||= signal.aborted ? 'Stopped trace' : 'Trace failed';
            });
        } finally {
            job.clearTicker();
            this.controllers.delete(job.controller);
        }
    }
    stop() {
        if (this.saving) return;
        if (this.activeJob) {
            const job = this.activeJob;
            job.controller.abort();
            job.clearTicker();
            job.state = 'stopped';
            job.status = 'Stopped.';
            job.title ||= 'Stopped trace';
            return;
        }
        if (this.savingRevision) return;
        this.generation?.abort();
        if (this.ticker !== null) clearInterval(this.ticker);
        this.ticker = null;
    }
    async runTrace() {
        const prompt = this.prompt.trim();
        const original = this.editing;
        if (!prompt || this.busy || !this.repo.aiAvailable || this.disposed) return;
        if (!original) return this.runNewTrace(prompt);
        const outputs = { architecture: this.architecture, flowchart: this.flowchart, ...(this.sitemap ? { sitemap: true } : {}) },
            origin = original ? this.editWorkspace : this.workspace;
        if (!outputs.architecture && !outputs.flowchart && !outputs.sitemap) {
            this.setStatus('Select Code architecture, Flowchart, or Sitemap.', true);
            return;
        }
        if (outputs.sitemap && !this.deps.sitemap?.sitemap) {
            await this.deps.sitemap?.load();
            if (!this.deps.sitemap?.sitemap) {
                this.setStatus('Generate the repository sitemap before tracing screens. Your question has been kept.', true);
                return;
            }
            if (this.disposed || this.busy || this.editing !== original) return;
        }
        const ctl = new AbortController();
        this.generation = ctl;
        this.controllers.add(ctl);
        this.revisionBusy = true;
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
                { prompt, ...(original ? { previousTrace: plain(original), architecture: outputs.architecture } : {}), flow: outputs.flowchart, ...(outputs.sitemap ? { sitemap: true, architecture: outputs.architecture } : {}),
                    // a revision keeps the original's scope
                    ...(original ? (original.scope ? { scope: original.scope } : {}) : this.scopeBody), ...this.deps.getPick() },
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
            const trace = this.normalize({ ...(result.trace as object), outputs, used: result.used }, prompt);
            if (original) {
                if ((outputs.architecture && !trace.steps.length) || (outputs.flowchart && !trace.flow) || (outputs.sitemap && !trace.sitemap)) {
                    throw new Error('Not all requested outputs were returned. The original trace and edited question were kept. Try again.');
                }
                trace._doc = original._doc;
                trace.createdAt = original.createdAt;
                trace.plan = null;
                if (!outputs.flowchart) trace.flow = null;
                if (!outputs.sitemap) trace.sitemap = null;
            }
            trace.outputs = {
                architecture: outputs.architecture && trace.steps.length > 0,
                flowchart: outputs.flowchart && !!trace.flow,
                ...(outputs.sitemap ? { sitemap: !!trace.sitemap } : {}),
            };
            trace.pendingFlow = outputs.flowchart && !trace.flow;
            trace.pendingSitemap = !!outputs.sitemap && !trace.sitemap;
            runInAction(() =>
                this.setStatus(
                    'Done in ' + Math.round((Date.now() - start) / 1000) + 's' + spend(result)
                )
            );
            if (original) {
                runInAction(() => { this.savingRevision = true; });
            }
            await this.keepTrace(trace, origin);
            if (!this.disposed && !ctl.signal.aborted)
                runInAction(() => {
                    if (original) { this.editDraft = null; this.finishEdit(); }
                    this.prompt = '';
                    if (trace.pendingFlow)
                        this.setStatus(
                            'The walkthrough was kept, but the flowchart was missing. Use Edit to retry the requested outputs.',
                            true
                        );
                    if (trace.pendingSitemap) this.setStatus('Other outputs were kept, but Sitemap was missing. Use Edit to select Sitemap and regenerate.', true);
                });
        } catch (error) {
            if (!this.disposed)
                runInAction(() =>
                    this.setStatus(
                        ctl.signal.aborted
                            ? 'Stopped.'
                            : error instanceof Error && error.message !== 'no known services'
                              ? error.message
                              : outputs.sitemap ? 'The AI returned no usable trace outputs. Your question was kept; try again.' : "The answer didn't name any services on this map. Try rephrasing.",
                        !ctl.signal.aborted
                    )
                );
        } finally {
            clearInterval(timer);
            if (this.ticker === timer) this.ticker = null;
            this.controllers.delete(ctl);
            if (!this.disposed)
                runInAction(() => {
                    this.revisionBusy = false;
                    this.savingRevision = false;
                    this.generation = null;
                    if (ctl.signal.aborted) this.setStatus('Stopped.');
                });
        }
    }
    dispose() {
        this.disposed = true;
        for (const job of this.jobs) { job.controller.abort(); job.clearTicker(); }
        this.stop();
        this.controllers.forEach((ctl) => ctl.abort());
        this.controllers.clear();
    }
}

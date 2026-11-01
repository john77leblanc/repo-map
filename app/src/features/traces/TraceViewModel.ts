import { makeAutoObservable, observable, observableRef, isObservable, runInAction } from 'mobx';
import type { RepositoryModel } from '../../models/RepositoryModel';
import type { Services } from '../../shared/services/contracts';
import type { AgentPick, ChangeStatus, CodeRef, Review, ReviewFile, ReviewRequest, StreamResult, Trace, Workspace } from '../../models/types';
import { decodeTrace, encodeTrace, linkOf, normalizeTrace, plain, spend } from '../../models/trace';
import type { WorkspaceMap } from '../../models/trace';
import { TraceJob } from './TraceJob';
import { CopyFeedback } from '../../models/CopyFeedback';

const copyKey = (trace: Trace) => trace._doc || trace.title || 'trace';
import { countInferred } from '../../../../lib/flow.mjs';
import type { SitemapViewModel } from '../sitemap/SitemapViewModel';
import type { ComponentsViewModel } from '../components/ComponentsViewModel';

/** The composer's question and output choices, kept aside while editing or watching a job. */
interface Picks { prompt: string; architecture: boolean; flowchart: boolean; sitemap: boolean; components: boolean }
/** Browser-storage keys of the output choices. */
const OUTPUT_KEYS: Record<Workspace, string> = { architecture: 'witharchitecture', flowchart: 'withflow', sitemap: 'withsitemap', components: 'withcomponents' };
/** The outputs a trace asks for, from the composer's choices (sitemap and components only when picked). */
const askFor = (p: Omit<Picks, 'prompt'>): Trace['outputs'] => ({ architecture: p.architecture, flowchart: p.flowchart,
    ...(p.sitemap ? { sitemap: true } : {}), ...(p.components ? { components: true } : {}) });
/** The extra outputs, as the trace and review routes take them. */
const extraBody = (outputs: Trace['outputs']) => ({ ...(outputs.sitemap ? { sitemap: true } : {}), ...(outputs.components ? { components: true } : {}) });
const NONE_PICKED = 'Select Code architecture, Flowchart, Sitemap, or Components.';
const MISSING_COMPONENTS = 'Generate the component map before tracing components. Your question has been kept.';
/** What the status says when an asked-for output came back missing (null: nothing missing). */
function missingNote(trace: Trace, review: boolean) {
    const missing = [trace.pendingFlow && 'the flowchart', trace.pendingSitemap && 'Sitemap', trace.pendingComponents && 'Components']
        .filter((x): x is string => !!x);
    if (!missing.length) return null;
    const what = missing.join(' and ') + ' ' + (missing.length > 1 ? 'were' : 'was') + ' missing.';
    if (review) return 'The review was kept, but ' + what + ' Re-run the review to try again.';
    const one = missing.length === 1 && !trace.pendingFlow ? missing[0] : '';
    return (one || missing.length > 1 ? 'Other outputs were kept, but ' : 'The walkthrough was kept, but ')
        + what + (one ? ' Use Edit to select ' + one + ' and regenerate.' : ' Use Edit to retry the requested outputs.');
}

/** A collapsible section of the trace sidebar. */
export type TraceSection = 'summary' | 'proposal' | 'review' | 'files' | 'steps' | 'outputs';
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
    components?: ComponentsViewModel;
    /** The map scope: new traces follow the workspace when it is shown. */
    getScope?(): 'repo' | 'workspace';
    /** The workspace's merged map, once loaded. */
    getWorkspaceMap?(): WorkspaceMap | null;
    /** Titles of linked repos by name. */
    getRepoTitles?(): Record<string, string>;
    /** Resolves once the workspace has loaded (or failed to), so workspace traces read the merged map. */
    workspaceReady?(): Promise<void>;
    /** Show a review job that hasn't finished (its progress, or why it failed). */
    onOpenReview?(job: TraceJob): void;
}
/** Whether a saved review still matches the code (POST /api/review/status). */
export interface ReviewState {
    state: 'current' | 'stale' | 'unknown';
    reason?: string;
    prState?: string;
}
const reviewKey = (trace: Trace) => trace.review ? trace.review.kind + ':' + trace.review.headSha + ':' + (trace.review.fingerprint || '') + ':' + (trace._doc || '') : '';
/** What a saved review compared, as a request to review it again. */
function reviewRequest(review: Review): ReviewRequest {
    if (review.kind === 'pr') return { pr: String(review.number || '') };
    if (review.kind === 'local') return { local: true, base: review.base };
    return { base: review.base, head: review.headRef || review.head };
}
/** The sidebar's "question" for a review that is still running. */
function reviewPrompt(request: ReviewRequest) {
    if (request.pr) return 'Review pull request #' + request.pr.replace(/^#/, '').replace(/^.*\/pull\/(\d+).*$/, '$1');
    if (request.local) return 'Review local changes' + (request.base ? ' against ' + request.base : '');
    return 'Review ' + (request.head || 'this branch') + (request.base ? ' against ' + request.base : '');
}
/** Sidebar type filter: every trace, or one intent. */
export type TraceKindFilter = 'all' | Trace['intent'];
const KINDS: Trace['intent'][] = ['description', 'proposal', 'review'];
const matches = (query: string, ...texts: (string | undefined)[]) =>
    !query || texts.some((t) => (t || '').toLowerCase().includes(query));
export class TraceViewModel {
    selected: Trace | null = null;
    /** Sidebar list filters (not saved). */
    kindFilter: TraceKindFilter = 'all';
    query = '';
    editing: Trace | null = null;
    private editDefaults: Picks | null = null;
    private editWorkspace: Workspace = 'architecture';
    savingRevision = false;
    private editDraft: (Picks & { id: string }) | null = null;
    jobs: TraceJob[] = [];
    activeJob: TraceJob | null = null;
    private jobDefaults: Picks | null = null;
    items: Trace[] = [];
    temp: Trace | null = null;
    ready = false;
    composerOpen = false;
    prompt = '';
    architecture = true;
    flowchart = true;
    sitemap = false;
    components = false;
    private message = '';
    private statusError = false;
    private revisionBusy = false;
    importCode = '';
    importMessage = '';
    code = '';
    /** Which trace sidebar sections are open (kept while switching traces). */
    sections: Record<TraceSection, boolean> = { summary: false, proposal: false, review: true, files: false, steps: true, outputs: false };
    /** Review status checks, by review (see reviewKey). */
    reviewStates: Record<string, ReviewState> = {};
    /** Which card groups of a review's changed files are open, by card id ('' = other files). */
    openFileGroups: Record<string, boolean> = {};
    storeNote =
        'Saved automatically to .repo-map/traces on this machine (git-ignored). Open an output to explore it.';
    /** "Copied!" on a trace's Copy trace code button, keyed by trace. */
    readonly copy = new CopyFeedback();
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
                copy: false,
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
        if (trace.outputs.components && trace.components) outputs.push('components');
        return outputs;
    }
    /** The composer's choices now. */
    private get picks(): Picks {
        return { prompt: this.prompt, architecture: this.architecture, flowchart: this.flowchart, sitemap: this.sitemap, components: this.components };
    }
    /** Inferred nodes and edges in the selected trace's flowchart. */
    get flowInferred(): number {
        return countInferred(this.selected?.flow);
    }
    get rows() {
        return this.temp
            ? [this.temp, ...this.items.filter((t) => t.key !== this.temp?._doc)]
            : this.items;
    }
    /** Saved traces (and running reviews) of each intent. */
    get kindCounts(): Record<Trace['intent'], number> {
        const counts = { description: 0, proposal: 0, review: 0 };
        for (const t of this.rows) counts[t.intent]++;
        for (const job of this.jobRows) if (job.review) counts.review++;
        return counts;
    }
    /** The type filter only shows when the list holds more than one kind. */
    get showFilters() {
        return KINDS.filter((k) => this.kindCounts[k] > 0).length > 1;
    }
    /** The filter in effect: 'all' while the filter is hidden. */
    get activeKind(): TraceKindFilter {
        return this.showFilters ? this.kindFilter : 'all';
    }
    get filteredRows() {
        const kind = this.activeKind;
        const query = this.query.trim().toLowerCase();
        return this.rows.filter((t) => (kind === 'all' || t.intent === kind) && matches(query, t.title, t.prompt));
    }
    /** Running jobs: reviews are known; other jobs' kind is known only once done, so they stay under Traces and Proposals. */
    get filteredJobRows() {
        const kind = this.activeKind;
        const query = this.query.trim().toLowerCase();
        return this.jobRows.filter((job) => (kind === 'all' || (job.review ? kind === 'review' : kind !== 'review')) &&
            matches(query, job.title, job.prompt));
    }
    get filtering() {
        return this.activeKind !== 'all' || !!this.query.trim();
    }
    setKindFilter(kind: TraceKindFilter) {
        this.kindFilter = kind;
    }
    setQuery(value: string) {
        this.query = value;
    }
    clearFilters() {
        this.kindFilter = 'all';
        this.query = '';
    }
    setPrompt(value: string) {
        this.prompt = value;
    }
    setOutput(output: Workspace, value: boolean) {
        this[output] = value;
        if (this.editing || this.activeJob) return;
        try {
            this.deps.services.storage.setRaw(this.repo.namespace + OUTPUT_KEYS[output], value ? '1' : '0');
        } catch {
            /* Preferences are optional when storage is unavailable. */
        }
        if (output === 'sitemap' && value) void this.deps.sitemap?.load();
        if (output === 'components' && value) this.loadComponents();
    }
    /** The component map (and the sitemap it is generated from), for the Components output. */
    private loadComponents() {
        if (!this.deps.components?.components) void this.deps.components?.load();
        if (!this.deps.sitemap?.sitemap) void this.deps.sitemap?.load();
    }
    setImportCode(value: string) {
        this.importCode = value;
    }
    editPrompt(trace: Trace) {
        if (this.busy || this.editing || this.disposed || !trace._doc) return;
        this.editDefaults = this.picks;
        this.editWorkspace = this.workspace;
        this.clear(); // Disconnect output views and cancel their active jobs.
        this.editing = trace;
        this.selected = isObservable(trace) ? trace : observable(trace);
        this.prompt = trace.prompt;
        this.architecture = trace.outputs.architecture;
        this.flowchart = trace.outputs.flowchart || trace.pendingFlow;
        this.sitemap = !!(trace.outputs.sitemap || trace.pendingSitemap);
        this.components = !!(trace.outputs.components || trace.pendingComponents);
        if (this.editDraft?.id === trace._doc) {
            const { id: _id, ...draft } = this.editDraft;
            Object.assign(this, draft);
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
        this.editDraft = { id: original._doc!, ...this.picks };
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
        this.openComposer();
    }
    /** Open the composer on a new trace (a no-op while it is open). */
    openComposer() {
        if (this.editing || this.composerOpen) return;
        if (this.selected) this.clear();
        this.message = '';
        this.statusError = false;
        this.composerOpen = true;
    }
    /** A trace that failed or was stopped can be deleted; it was never saved. */
    get canDeleteJob() {
        return !!this.activeJob && !this.activeJob.busy && !this.activeJob.result;
    }
    /**
     * Remove a failed or stopped job (trace or review) from the list. Nothing was saved,
     * so there is no server call; a saved review it was re-running stays as it was.
     */
    discardJob(job: TraceJob) {
        if (this.disposed || job.busy || job.result) return;
        this.jobs = this.jobs.filter((j) => j !== job);
        if (this.activeJob !== job) return;
        if (this.jobDefaults) Object.assign(this, this.jobDefaults);
        this.jobDefaults = null;
        this.activeJob = null;
        this.message = '';
        this.statusError = false;
        this.composerOpen = false;
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
        if (job.review && !(job.result && !job.busy)) {
            this.deps.onOpenReview?.(job);
            return;
        }
        if (job.result && !job.busy) {
            if (job.saveFailed) this.temp = job.result;
            this.message = job.status;
            this.statusError = job.error;
            return this.openSavedOutput(job.result, this.resultWorkspace(job.result, job.workspace));
        }
        this.releaseJob();
        this.jobDefaults = this.picks;
        this.clear();
        this.activeJob = job;
        this.prompt = job.prompt;
        Object.assign(this, job.outputs, { sitemap: !!job.outputs.sitemap, components: !!job.outputs.components });
        this.composerOpen = true;
    }
    setStatus(text: string, error = false) {
        this.message = text;
        this.statusError = error;
        if (error) this.composerOpen = true;
    }
    init() {
        for (const output of ['architecture', 'flowchart', 'sitemap', 'components'] as const) {
            try {
                const value = this.deps.services.storage.getRaw(this.repo.namespace + OUTPUT_KEYS[output]);
                if (value !== null) this[output] = value === '1';
            } catch {
                /* Keep defaults. */
            }
        }
        if (this.sitemap) void this.deps.sitemap?.load();
        if (this.components) this.loadComponents();
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
        if (this.selected.review && !this.reviewStates[reviewKey(this.selected)]) void this.checkReview(this.selected);
    }
    clear() {
        this.releaseJob();
        this.selectionVersion++;
        this.selected = null;
        this.code = '';
        this.deps.onClear();
    }
    setSection(id: TraceSection, open: boolean) {
        this.sections[id] = open;
    }
    reveal(id: string) {
        this.deps.onReveal(id);
    }
    openPlan(trace: Trace) {
        this.deps.onOpenPlan(trace);
    }
    /** True while an implementation plan is being written for `trace`. */
    isPlanBusy(trace: Trace) {
        return !!this.deps.isPlanBusy?.(trace);
    }
    get planBusy() {
        return !!this.selected && !!this.deps.isPlanBusy?.(this.selected);
    }
    /**
     * Open a trace on `output`. `explicit` (an output was picked) may draw a missing flowchart
     * or turn on the architecture output; otherwise a missing view just shows its message.
     */
    async openSavedOutput(item: Trace, output: Workspace, explicit = true) {
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
        if (output === 'sitemap' || output === 'components' || !explicit) {
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
    /** Open a library trace on the view already showing. */
    openTrace(item: Trace) {
        return this.openSavedOutput(item, this.workspace, false);
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
        // nothing to show yet: the view of an output that was asked for, so its message offers to draw it
        const asked = ([
            ['architecture', trace.outputs.architecture],
            ['flowchart', trace.outputs.flowchart || trace.pendingFlow],
            ['sitemap', trace.outputs.sitemap || trace.pendingSitemap],
            ['components', trace.outputs.components || trace.pendingComponents],
        ] as [Workspace, boolean | undefined][]).filter(([, on]) => on).map(([id]) => id);
        return asked.includes(preferred) ? preferred : asked[0] || 'architecture';
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
            if (!this.disposed) this.copy.flash(copyKey(trace));
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
        const outputs = askFor(this.picks);
        if (!outputs.architecture && !outputs.flowchart && !outputs.sitemap && !outputs.components) {
            this.setStatus(NONE_PICKED, true);
            return;
        }
        if (!this.activeJob) this.jobDefaults = { ...this.picks, prompt: '' };
        else this.jobs = this.jobs.filter((job) => job !== this.activeJob);
        const job = new TraceJob(prompt, outputs, { ...this.deps.getPick() }, this.deps.getPickLabel(), this.workspace);
        this.jobs.unshift(job);
        this.activeJob = job;
        return this.runJob(job, '/api/trace', { prompt, flow: outputs.flowchart,
            ...(outputs.sitemap || outputs.components ? { ...extraBody(outputs), architecture: outputs.architecture } : {}), ...this.scopeBody, ...job.pick });
    }
    /**
     * Review a code change (a pull request, two refs, or local changes). It runs as a
     * job in the trace list and is saved as a trace with intent 'review'. `replace`
     * is a saved review being re-run: the result takes its place.
     */
    startReview(request: ReviewRequest, outputs: Trace['outputs'] = this.reviewOutputs, replace: Trace | null = null): TraceJob | null {
        if (this.disposed || !this.repo.aiAvailable) return null;
        if (this.jobs.some((job) => job.review && job.busy)) {
            // said in the review window; the trace composer stays closed
            this.message = 'A review is already running.';
            this.statusError = true;
            return null;
        }
        // a review always shows the change on the map: its changed files are grouped by card
        const wanted = askFor({ architecture: true, flowchart: !!outputs.flowchart, sitemap: !!outputs.sitemap, components: !!outputs.components });
        const job = new TraceJob(reviewPrompt(request), wanted, { ...this.deps.getPick() }, this.deps.getPickLabel(), 'architecture');
        job.review = { ...request };
        job.replaces = replace?._doc || '';
        this.jobs.unshift(job);
        void this.runJob(job, '/api/review', { ...request, flow: wanted.flowchart, sitemap: !!wanted.sitemap, ...extraBody(wanted), ...job.pick }, replace);
        return job;
    }
    /** The outputs picked in the composer, as a review asks for them (always with the map). */
    get reviewOutputs(): Trace['outputs'] {
        return askFor({ ...this.picks, architecture: true });
    }
    /** Re-run a saved review on the code as it is now, with the outputs it has; the result replaces it. */
    rerunReview(trace: Trace) {
        if (!trace.review) return null;
        const outputs = askFor({ architecture: true, flowchart: trace.outputs.flowchart || trace.pendingFlow,
            sitemap: !!(trace.outputs.sitemap || trace.pendingSitemap), components: !!(trace.outputs.components || trace.pendingComponents) });
        return this.startReview(reviewRequest(trace.review), outputs, trace);
    }
    /** Ask whether the selected review still matches its branch or pull request. */
    async checkReview(trace: Trace) {
        if (!trace.review || this.disposed) return;
        const key = reviewKey(trace);
        const ctl = new AbortController();
        this.controllers.add(ctl);
        try {
            const result = await this.deps.services.api.request<ReviewState>('/api/review/status',
                { method: 'POST', signal: ctl.signal, body: JSON.stringify({ review: trace.review }) });
            if (!this.disposed && !ctl.signal.aborted) runInAction(() => { this.reviewStates[key] = result; });
        } catch {
            if (!this.disposed && !ctl.signal.aborted) runInAction(() => { this.reviewStates[key] = { state: 'unknown', reason: "Couldn't check." }; });
        } finally {
            this.controllers.delete(ctl);
        }
    }
    /** Whether a review still matches the code, once checked. */
    reviewState(trace: Trace): ReviewState | null {
        return trace.review ? this.reviewStates[reviewKey(trace)] || null : null;
    }
    /** Stop one job (a review runs beside the composer's job). */
    stopJob(job: TraceJob) {
        if (!job.busy || job.state === 'saving') return;
        job.controller.abort();
        job.clearTicker();
        job.state = 'stopped';
        job.status = 'Stopped.';
        job.title ||= job.review ? 'Stopped review' : 'Stopped trace';
    }
    /**
     * A review's changed files, grouped by the card they belong to (cards in step
     * order, then the others), with files that fit no card last.
     */
    reviewFileGroups(trace: Trace): { id: string; title: string; status?: ChangeStatus; files: ReviewFile[] }[] {
        const files = trace.review?.files || [];
        const order = [...trace.steps.map((s) => s.id), ...(trace.proposal?.nodes || []).map((n) => n.id)];
        const ids = [...new Set([...order, ...files.flatMap((f) => f.cards)])].filter((id) => files.some((f) => f.cards.includes(id)));
        const groups = ids.map((id) => ({ id, title: this.stepTitle(trace, id), status: trace.proposal?.nodes.find((n) => n.id === id)?.status,
            files: files.filter((f) => f.cards.includes(id)) }));
        const other = files.filter((f) => !f.cards.length);
        return other.length ? [...groups, { id: '', title: 'Other files', files: other }] : groups;
    }
    /** A changed file as a reference that opens its diff. */
    fileReference(trace: Trace, file: ReviewFile): CodeRef {
        const review = trace.review!;
        return { path: file.path, start: 1, end: 1, why: file.note || undefined,
            diff: { base: review.mergeBase, head: review.kind === 'local' ? '' : review.headSha } };
    }
    isFileGroupOpen(id: string) {
        return !!this.openFileGroups[id];
    }
    setFileGroup(id: string, open: boolean) {
        this.openFileGroups[id] = open;
    }
    /** The running or finished review job for a re-run of `trace`. */
    rerunJob(trace: Trace) {
        return trace._doc ? this.jobs.find((job) => job.replaces === trace._doc && job.busy) || null : null;
    }
    private async runJob(job: TraceJob, url: string, body: Record<string, unknown>, replace: Trace | null = null) {
        const outputs = job.outputs as Trace['outputs'];
        const signal = job.controller.signal;
        this.controllers.add(job.controller);
        const current = () => !this.disposed && !signal.aborted;
        let last = 'Starting ' + job.agentLabel + '...';
        job.progress.start(last);
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
            if (outputs.components && !this.deps.components?.components) {
                await this.deps.components?.load();
                if (!current()) return;
                if (!this.deps.components?.components) throw new Error(MISSING_COMPONENTS);
            }
            const result = await this.deps.services.api.stream<StreamResult>(url, body,
                signal, (text) => { last = text; if (current()) job.progress.push(text); tick(); },
                (title) => { if (current() && job.state === 'running') runInAction(() => { job.title = title.trim().slice(0, 80); }); });
            if (!current()) return;
            job.clearTicker();
            if (!result) throw new Error(job.agentLabel + ' ended without an answer. Run repo-map doctor to check your setup.');
            const trace = observable(this.normalize({ ...(result.trace as object), outputs, used: result.used }, job.review ? undefined : job.prompt));
            trace.createdAt = replace?.createdAt || job.createdAt;
            if (replace?._doc) trace._doc = replace._doc;
            trace.outputs = {
                architecture: outputs.architecture && trace.steps.length > 0,
                flowchart: outputs.flowchart && !!trace.flow,
                ...(outputs.sitemap ? { sitemap: !!trace.sitemap } : {}),
                ...(outputs.components ? { components: !!trace.components } : {}),
            };
            trace.pendingFlow = outputs.flowchart && !trace.flow;
            trace.pendingSitemap = !!outputs.sitemap && !trace.sitemap;
            trace.pendingComponents = !!outputs.components && !trace.components;
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
                } else if (missingNote(trace, !!job.review)) {
                    job.status = missingNote(trace, !!job.review)!;
                    job.error = true;
                }
                if (replace && this.selected?._doc === replace._doc) delete this.reviewStates[reviewKey(replace)];
                // a review opens when it is done, unless another trace is open (a re-run opens over its original)
                const open = job.review ? !this.editing && !this.composerOpen && (!this.selected || this.selected._doc === replace?._doc) : this.activeJob === job;
                if (open) {
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
                job.title ||= job.review ? (signal.aborted ? 'Stopped review' : 'Review failed') : signal.aborted ? 'Stopped trace' : 'Trace failed';
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
        const outputs = askFor(this.picks),
            origin = original ? this.editWorkspace : this.workspace;
        if (!outputs.architecture && !outputs.flowchart && !outputs.sitemap && !outputs.components) {
            this.setStatus(NONE_PICKED, true);
            return;
        }
        if (outputs.components && !this.deps.components?.components) {
            await this.deps.components?.load();
            if (!this.deps.components?.components) {
                this.setStatus(MISSING_COMPONENTS, true);
                return;
            }
            if (this.disposed || this.busy || this.editing !== original) return;
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
                { prompt, ...(original ? { previousTrace: plain(original), architecture: outputs.architecture } : {}), flow: outputs.flowchart,
                    ...(outputs.sitemap || outputs.components ? { ...extraBody(outputs), architecture: outputs.architecture } : {}),
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
                if ((outputs.architecture && !trace.steps.length) || (outputs.flowchart && !trace.flow) || (outputs.sitemap && !trace.sitemap)
                    || (outputs.components && !trace.components)) {
                    throw new Error('Not all requested outputs were returned. The original trace and edited question were kept. Try again.');
                }
                trace._doc = original._doc;
                trace.createdAt = original.createdAt;
                trace.plan = null;
                if (!outputs.flowchart) trace.flow = null;
                if (!outputs.sitemap) trace.sitemap = null;
                if (!outputs.components) trace.components = null;
            }
            trace.outputs = {
                architecture: outputs.architecture && trace.steps.length > 0,
                flowchart: outputs.flowchart && !!trace.flow,
                ...(outputs.sitemap ? { sitemap: !!trace.sitemap } : {}),
                ...(outputs.components ? { components: !!trace.components } : {}),
            };
            trace.pendingFlow = outputs.flowchart && !trace.flow;
            trace.pendingSitemap = !!outputs.sitemap && !trace.sitemap;
            trace.pendingComponents = !!outputs.components && !trace.components;
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
                    const missing = missingNote(trace, false);
                    if (missing) this.setStatus(missing, true);
                });
        } catch (error) {
            if (!this.disposed)
                runInAction(() =>
                    this.setStatus(
                        ctl.signal.aborted
                            ? 'Stopped.'
                            : error instanceof Error && error.message !== 'no known services'
                              ? error.message
                              : outputs.sitemap || outputs.components ? 'The AI returned no usable trace outputs. Your question was kept; try again.' : "The answer didn't name any services on this map. Try rephrasing.",
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
    /** True for a moment after this trace's code was copied. */
    codeCopied(trace: Trace) {
        return this.copy.isCopied(copyKey(trace));
    }
    dispose() {
        this.disposed = true;
        this.copy.dispose();
        for (const job of this.jobs) { job.controller.abort(); job.clearTicker(); }
        this.stop();
        this.controllers.forEach((ctl) => ctl.abort());
        this.controllers.clear();
    }
}

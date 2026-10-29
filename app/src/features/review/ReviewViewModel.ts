import { makeAutoObservable, observableRef, reaction, runInAction } from 'mobx';
import type { RepositoryModel } from '../../models/RepositoryModel';
import { ComboboxModel, type ComboboxOption } from '../../models/ComboboxModel';
import type { ReviewRequest } from '../../models/types';
import type { TraceJob } from '../traces/TraceJob';
import type { TraceViewModel } from '../traces/TraceViewModel';

export type ReviewMode = 'refs' | 'pr' | 'local';

export interface ReviewDependencies {
    repo: RepositoryModel;
    traces: TraceViewModel;
    getPickLabel(): string;
    /** Seconds since the epoch (tests pass a fixed clock). */
    now?(): number;
}

/** A branch or tag from GET /api/review/refs. */
export interface ReviewRef {
    name: string;
    kind: 'local' | 'remote' | 'tag';
    sha: string;
    date: number;
    subject: string;
    ahead?: number;
    behind?: number;
    alsoRemote?: boolean;
}
interface RefList {
    current: string;
    defaultBranch: string;
    aheadOf: string;
    more: boolean;
    refs: ReviewRef[];
}
/** An open pull request from GET /api/review/prs. */
export interface ReviewPr {
    number: number;
    title: string;
    author: string;
    head: string;
    base: string;
    draft: boolean;
}

const MODES: ReviewMode[] = ['refs', 'pr', 'local'];
const BASE_SETTLE_MS = 300;

/** "5m", "3h", "2d", "3w", "4mo", "2y": how long ago a commit was made. */
export function formatAge(seconds: number, now: number): string {
    const s = Math.max(0, now - seconds);
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + 'm';
    if (s < 86400) return Math.round(s / 3600) + 'h';
    if (s < 86400 * 14) return Math.round(s / 86400) + 'd';
    if (s < 86400 * 60) return Math.round(s / 604800) + 'w';
    if (s < 86400 * 365) return Math.round(s / 2592000) + 'mo';
    return Math.round(s / 31536000) + 'y';
}

/**
 * The "Review changes" window: what to compare (two branches, a GitHub pull
 * request, or local changes), picked from lists of branches, tags and open pull
 * requests or typed, then the running review's progress. The review itself runs
 * as a trace job (TraceViewModel.startReview), so it keeps going when this window
 * closes and is saved like a trace.
 */
export class ReviewViewModel {
    open = false;
    mode: ReviewMode = 'refs';
    message = '';
    job: TraceJob | null = null;
    readonly headBox: ComboboxModel;
    readonly baseBox: ComboboxModel;
    readonly prBox: ComboboxModel;
    refs: RefList | null = null;
    refsLoading = false;
    refsError = '';
    prs: ReviewPr[] | null = null;
    prsLoading = false;
    prsReason = '';
    fetching = false;
    fetchMessage = '';
    fetchError = false;
    private stopWatch: () => void;
    private settle: ReturnType<typeof setTimeout> | null = null;
    private refsCall: AbortController | null = null;
    private prsCall: AbortController | null = null;
    constructor(readonly deps: ReviewDependencies) {
        this.headBox = new ComboboxModel();
        // counts follow the base: reload once typing settles, or at once when one is chosen
        this.baseBox = new ComboboxModel('', () => this.baseChanged());
        this.prBox = new ComboboxModel();
        makeAutoObservable<this, 'stopWatch' | 'settle' | 'refsCall' | 'prsCall'>(this, {
            deps: false, job: observableRef, refs: observableRef, prs: observableRef,
            headBox: false, baseBox: false, prBox: false,
            stopWatch: false, settle: false, refsCall: false, prsCall: false,
        }, { autoBind: true });
        // the window closes once its review is saved: the review opens in its place
        this.stopWatch = reaction(() => this.job?.state, (state) => {
            if (state === 'completed' && this.job?.result && !this.job.saveFailed) this.close();
        });
    }
    private get api() {
        return this.deps.repo.services.api;
    }
    get defaultBranch() {
        return this.refs?.defaultBranch || String(this.deps.repo.bootstrap?.config.defaultBranch || 'main');
    }
    get branch() {
        return this.refs?.current || this.deps.repo.bootstrap?.repo.branch || '';
    }
    get base() {
        return this.baseBox.value;
    }
    get head() {
        return this.headBox.value;
    }
    get pr() {
        return this.prBox.value;
    }
    /** Pull requests need a GitHub remote (and the gh CLI on this machine). */
    get github() {
        return !!this.deps.repo.bootstrap?.repo.github;
    }
    get aiAvailable() {
        return this.deps.repo.aiAvailable;
    }
    get busy() {
        return !!this.job?.busy;
    }
    get status() {
        if (this.job) return this.job.state === 'running' ? this.job.status || 'Starting…' : this.job.status;
        return this.message;
    }
    get error() {
        return this.job ? this.job.error : !!this.message;
    }
    get agentLabel() {
        return this.deps.getPickLabel();
    }
    /** What will be reviewed. */
    get request(): ReviewRequest | null {
        const base = this.base.trim(), head = this.head.trim(), pr = this.pr.trim();
        if (this.mode === 'pr') return pr ? { pr } : null;
        if (this.mode === 'local') return { local: true, ...(base ? { base } : {}) };
        return { ...(base ? { base } : {}), ...(head ? { head } : {}) };
    }
    get title() {
        return this.job ? this.job.title || 'Reviewing changes…' : 'Review changes';
    }
    /** The chosen head has nothing the base doesn't: the review would be empty. */
    get nothingToReview() {
        const head = this.refs?.refs.find((r) => r.name === (this.head.trim() || this.branch));
        return this.mode === 'refs' && !!head && head.ahead === 0;
    }
    private now() {
        return this.deps.now?.() ?? Math.floor(Date.now() / 1000);
    }
    private refMeta(ref: ReviewRef, withCounts: boolean) {
        const parts = [formatAge(ref.date, this.now())];
        if (withCounts && ref.ahead !== undefined) parts.push(ref.ahead ? ref.ahead + ' ahead' : 'nothing to review');
        return parts.join(' · ');
    }
    private refOptions(forHead: boolean): ComboboxOption[] {
        const list = this.refs;
        if (!list) return [];
        const group = { local: 'Branches', remote: 'Remote branches', tag: 'Tags' } as const;
        const option = (r: ReviewRef): ComboboxOption => ({
            value: r.name,
            label: (r.name === list.current && r.kind === 'local' ? '● ' : '') + r.name,
            meta: this.refMeta(r, forHead),
            group: group[r.kind],
            muted: forHead && r.ahead === 0,
            title: r.subject + (r.alsoRemote ? ' (also on the remote)' : ''),
        });
        const order = { local: 0, remote: 1, tag: 2 } as const;
        const sorted = [...list.refs].sort((a, b) => order[a.kind] - order[b.kind]);
        if (!forHead) {
            // the default branch first
            const first = sorted.filter((r) => r.name === list.defaultBranch || r.name === 'origin/' + list.defaultBranch);
            return [...first.map((r) => ({ ...option(r), group: 'Default branch' })), ...sorted.filter((r) => !first.includes(r)).map(option)];
        }
        return sorted.map(option);
    }
    private prOptions(): ComboboxOption[] {
        return (this.prs || []).map((p) => ({
            value: String(p.number), label: `#${p.number} ${p.title}`, group: 'Open pull requests',
            meta: [p.author, `${p.head} → ${p.base}`, p.draft ? 'draft' : ''].filter(Boolean).join(' · '),
            title: `${p.head} → ${p.base}`,
        }));
    }
    private applyOptions() {
        this.headBox.setOptions(this.refOptions(true));
        this.baseBox.setOptions(this.refOptions(false));
        this.prBox.setOptions(this.prOptions());
    }
    /** Branches and tags, with how far each is ahead of the base in the form. */
    async loadRefs() {
        this.refsCall?.abort();
        const ctl = (this.refsCall = new AbortController());
        this.refsLoading = true;
        this.refsError = '';
        const base = this.base.trim();
        try {
            const list = await this.api.get<RefList>('/api/review/refs' + (base ? '?base=' + encodeURIComponent(base) : ''), ctl.signal);
            if (ctl.signal.aborted) return;
            if (!Array.isArray(list?.refs)) throw new Error('unexpected answer');
            runInAction(() => {
                this.refs = list;
                this.applyOptions();
            });
        } catch (error) {
            if (ctl.signal.aborted) return;
            // a base being typed may not exist yet: keep the last list
            runInAction(() => {
                this.refsError = base && this.refs ? `No branch, tag or commit called ${base}.` : `Couldn't list branches (${error instanceof Error ? error.message : error}). You can still type names.`;
            });
        } finally {
            if (this.refsCall === ctl) runInAction(() => { this.refsLoading = false; this.refsCall = null; });
        }
    }
    /** Open pull requests from gh; when gh can't be used, why. */
    async loadPrs() {
        this.prsCall?.abort();
        const ctl = (this.prsCall = new AbortController());
        this.prsLoading = true;
        try {
            const out = await this.api.get<{ prs: ReviewPr[]; reason?: string }>('/api/review/prs', ctl.signal);
            if (ctl.signal.aborted) return;
            runInAction(() => {
                this.prs = out.prs || [];
                this.prsReason = out.reason || (this.prs.length ? '' : 'No open pull requests.');
                this.applyOptions();
            });
        } catch (error) {
            if (!ctl.signal.aborted) runInAction(() => { this.prsReason = `Couldn't list pull requests (${error instanceof Error ? error.message : error}).`; });
        } finally {
            if (this.prsCall === ctl) runInAction(() => { this.prsLoading = false; this.prsCall = null; });
        }
    }
    /** Refresh remote branches with git fetch, then the lists. */
    async fetchRemote() {
        if (this.fetching) return;
        this.fetching = true;
        this.fetchMessage = 'Fetching from origin…';
        this.fetchError = false;
        try {
            await this.api.request('/api/review/fetch', { method: 'POST' });
            runInAction(() => { this.fetchMessage = 'Fetched just now.'; });
            await Promise.all([this.loadRefs(), this.mode === 'pr' ? this.loadPrs() : null]);
        } catch (error) {
            runInAction(() => {
                this.fetchMessage = error instanceof Error ? error.message : String(error);
                this.fetchError = true;
            });
        } finally {
            runInAction(() => { this.fetching = false; });
        }
    }
    private baseChanged() {
        if (this.settle) clearTimeout(this.settle);
        this.settle = setTimeout(() => {
            this.settle = null;
            if (this.open) void this.loadRefs();
        }, BASE_SETTLE_MS);
    }
    private loadLists() {
        void this.loadRefs();
        if (this.mode === 'pr' && !this.prs) void this.loadPrs();
    }
    openNew(mode: ReviewMode = this.mode) {
        if (MODES.includes(mode)) this.mode = mode;
        this.job = null;
        this.message = '';
        if (!this.base) this.baseBox.setValue(this.defaultBranch);
        if (!this.head && this.branch && this.branch !== this.defaultBranch) this.headBox.setValue(this.branch);
        this.open = true;
        this.loadLists();
    }
    /** Show a review job that hasn't finished: its progress, or why it failed. */
    showJob(job: TraceJob) {
        this.job = job;
        const r = job.review || {};
        this.mode = r.pr ? 'pr' : r.local ? 'local' : 'refs';
        this.prBox.setValue(r.pr || '');
        this.baseBox.setValue(r.base || '');
        this.headBox.setValue(r.head || '');
        this.message = '';
        this.open = true;
        this.loadLists();
    }
    close() {
        this.open = false;
        this.job = null;
        this.message = '';
        this.headBox.close();
        this.baseBox.close();
        this.prBox.close();
    }
    setMode(mode: ReviewMode) {
        if (this.busy || !MODES.includes(mode)) return;
        this.mode = mode;
        this.job = null;
        this.message = '';
        if (mode === 'pr' && !this.prs && !this.prsLoading) void this.loadPrs();
    }
    setBase(value: string) {
        this.baseBox.type(value);
    }
    setHead(value: string) {
        this.headBox.type(value);
    }
    setPr(value: string) {
        this.prBox.type(value);
    }
    start() {
        if (this.busy) return;
        const request = this.request;
        if (!this.aiAvailable) {
            this.message = 'Reviews need an AI tool. Pick one in Settings.';
            return;
        }
        if (!request) {
            this.message = 'Pick or enter a pull request.';
            return;
        }
        this.message = '';
        // a failed or stopped review run again from the form takes its place
        if (this.canDelete) this.deps.traces.discardJob(this.job!);
        const job = this.deps.traces.startReview(request);
        if (job) this.job = job;
        else this.message = this.deps.traces.status || 'Couldn\'t start the review.';
    }
    stop() {
        if (this.job) this.deps.traces.stopJob(this.job);
    }
    /** Run a failed or stopped review again with what it compared and its outputs; it takes the old one's place. */
    retry() {
        const old = this.job;
        if (!old?.review || old.busy) return;
        if (!this.aiAvailable) {
            this.message = 'Reviews need an AI tool. Pick one in Settings.';
            return;
        }
        if (!old.result) this.deps.traces.discardJob(old);
        const job = this.deps.traces.startReview(old.review, old.outputs);
        if (job) this.job = job;
        else this.message = this.deps.traces.status || 'Couldn\'t start the review.';
    }
    /** Leave a finished job's progress for the form, keeping what it compared. */
    backToForm() {
        if (this.busy) return;
        this.job = null;
        this.message = '';
    }
    /** A review that failed or was stopped can be deleted; it was never saved. */
    get canDelete() {
        return !!this.job && !this.job.busy && !this.job.result;
    }
    /** Delete the failed review from the trace list and close the window. */
    discard() {
        if (!this.job || !this.canDelete) return;
        this.deps.traces.discardJob(this.job);
        this.close();
    }
    /**
     * `repo-map review` opens the page with ?review=pr|refs|local plus pr, base and head.
     * Fill the form from them and start the review.
     */
    fromQuery(query: Record<string, string>) {
        const mode = query.review as ReviewMode;
        if (!MODES.includes(mode)) return;
        this.mode = mode;
        this.prBox.setValue(query.pr || '');
        this.baseBox.setValue(query.base || (mode === 'pr' ? '' : this.defaultBranch));
        this.headBox.setValue(query.head || '');
        this.job = null;
        this.message = '';
        this.open = true;
        this.loadLists();
        this.start();
    }
    dispose() {
        this.stopWatch();
        if (this.settle) clearTimeout(this.settle);
        this.refsCall?.abort();
        this.prsCall?.abort();
    }
}

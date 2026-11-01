import { makeAutoObservable, reaction } from 'mobx';
import type { ReviewMode, ReviewViewModel } from '../review/ReviewViewModel';
import type { TraceJob } from '../traces/TraceJob';
import type { TraceViewModel } from '../traces/TraceViewModel';
import type { Workspace } from '../../models/types';

/** The New trace window's tabs: describe a question, or review a change. */
export type ComposerTab = 'describe' | ReviewMode;
export const COMPOSER_TABS: { id: ComposerTab; label: string }[] = [
    { id: 'describe', label: 'Describe' },
    { id: 'refs', label: 'Branches' },
    { id: 'pr', label: 'Pull request' },
    { id: 'local', label: 'Local changes' },
];
const OUTPUT_LABELS: Record<Workspace, string> = { architecture: 'Code architecture', flowchart: 'Flowchart', sitemap: 'Sitemap', components: 'Components' };

export interface OutputRow {
    id: Workspace;
    label: string;
    state: 'waiting' | 'done' | 'missing' | 'stopped';
}

export interface ComposerDependencies {
    traces: TraceViewModel;
    review: ReviewViewModel;
}

/**
 * The one "New trace" window: a Describe tab for questions (TraceViewModel's composer)
 * and Branches / Pull request / Local changes tabs for reviews (ReviewViewModel), with
 * shared Outputs, then the running job's progress. Each side keeps its own job and
 * fields; this decides which one shows and keeps only one open.
 */
export class ComposerViewModel {
    /** The tab the window opens on next (the last one used). */
    lastTab: ComposerTab = 'describe';
    /** Showing the form for a failed or stopped job, to change it before retrying. */
    formShown = false;
    private stopWatch: () => void;
    constructor(readonly deps: ComposerDependencies) {
        makeAutoObservable<this, 'stopWatch'>(this, { deps: false, stopWatch: false }, { autoBind: true });
        this.stopWatch = reaction(() => this.job, () => { this.formShown = false; });
    }
    private get traces() {
        return this.deps.traces;
    }
    private get review() {
        return this.deps.review;
    }
    /** The window shows while the trace composer (not the inline editor) or a review is open. */
    get open() {
        return this.review.open || (this.traces.composerOpen && !this.traces.editing && !this.traces.selected);
    }
    get tab(): ComposerTab {
        return this.review.open ? this.review.mode : 'describe';
    }
    get isReview() {
        return this.tab !== 'describe';
    }
    /** The job on the progress screen, if any. */
    get job(): TraceJob | null {
        return this.review.open ? this.review.job : this.traces.activeJob;
    }
    get busy() {
        return !!this.job?.busy;
    }
    /** Progress replaces the form while a job runs, and after it fails until Back to form. */
    get showProgress() {
        return !!this.job && (this.job.busy || !this.formShown);
    }
    get title() {
        if (this.job) return this.job.title || '';
        return 'New trace';
    }
    get status() {
        return this.isReview ? this.review.status : this.traces.status;
    }
    get error() {
        return this.isReview ? this.review.error : this.traces.error;
    }
    /** How many outputs the job will make (a review always draws the map). */
    get outputCount() {
        const t = this.traces;
        return Number(this.isReview || t.architecture) + Number(t.flowchart) + Number(t.sitemap) + Number(t.components);
    }
    /** The requested outputs and whether each came back. */
    get outputRows(): OutputRow[] {
        const job = this.job;
        if (!job) return [];
        const asked = (['architecture', 'flowchart', 'sitemap', 'components'] as const).filter((id) => job.outputs[id]);
        return asked.map((id) => ({
            id, label: OUTPUT_LABELS[id],
            state: job.result ? (job.result.outputs[id] ? 'done' : 'missing') : job.busy ? 'waiting' : 'stopped',
        }));
    }
    /** A failed or stopped job can be deleted; it was never saved. */
    get canDelete() {
        return this.isReview ? this.review.canDelete : this.traces.canDeleteJob;
    }
    openNew() {
        if (this.open) return;
        this.formShown = false;
        if (this.lastTab === 'describe') this.traces.openComposer();
        else this.review.openNew(this.lastTab);
    }
    /** Show a job that hasn't finished: a trace on Describe, a review on its tab. */
    showJob(job: TraceJob) {
        this.formShown = false;
        if (job.review) {
            this.traces.closeComposer();
            this.review.showJob(job);
        } else this.traces.openJob(job);
    }
    setTab(tab: ComposerTab) {
        if (this.busy || tab === this.tab) return;
        this.lastTab = tab;
        this.formShown = false;
        if (tab === 'describe') {
            this.review.close();
            this.traces.openComposer();
        } else if (this.review.open) this.review.setMode(tab);
        else {
            this.traces.closeComposer();
            this.review.openNew(tab);
        }
    }
    close() {
        if (this.review.open) this.review.close();
        else this.traces.closeComposer();
    }
    /** Outputs open or closed, shared with the inline trace editor. */
    get outputsOpen() {
        return this.traces.sections.outputs;
    }
    toggleOutputs(open: boolean) {
        this.traces.setSection('outputs', open);
    }
    submit() {
        if (this.isReview) this.review.start();
        else void this.traces.runTrace();
    }
    stop() {
        if (this.isReview) this.review.stop();
        else this.traces.stop();
    }
    /** Run the failed or stopped job again as it was. */
    retry() {
        this.formShown = false;
        if (this.isReview) this.review.retry();
        else void this.traces.runTrace();
    }
    backToForm() {
        if (!this.busy) this.formShown = true;
    }
    discard() {
        if (this.isReview) this.review.discard();
        else if (this.traces.activeJob) this.traces.discardJob(this.traces.activeJob);
    }
    /** `repo-map review` opens the page with ?review=…: open that tab and start. */
    fromQuery(query: Record<string, string>) {
        this.traces.closeComposer();
        this.review.fromQuery(query);
        if (this.review.open) this.lastTab = this.review.mode;
    }
    dispose() {
        this.stopWatch();
    }
}

import { makeAutoObservable, observable, observableRef, runInAction } from 'mobx';
import { normalizePlan } from '../../../../lib/proposal.mjs';
import { plain, spend } from '../../models/trace';
import type { RepositoryModel } from '../../models/RepositoryModel';
import type { AgentPick, Plan, StreamResult, Trace } from '../../models/types';
import type { Services } from '../../shared/services/contracts';
import { CopyFeedback } from '../../models/CopyFeedback';
export interface PlanDependencies {
    repo: RepositoryModel;
    services: Services;
    getPick(): AgentPick;
    saveTrace(trace: Trace): Promise<void>;
}
/** The plan's lists after its steps, in display order. */
export const SECTIONS = {
    interfaces: 'Interface changes',
    tests: 'Tests',
    risks: 'Risks',
    questions: 'Open questions',
} as const;
export type PlanSection = keyof typeof SECTIONS;
export const SECTION_KEYS = Object.keys(SECTIONS) as PlanSection[];
/** The plan as Markdown: steps are a task list that keeps what was ticked. */
export function planMarkdown(plan: Plan) {
    const step = (t: Plan['tasks'][number], i: number) => {
        const marker = `${i + 1}. `,
            pad = ' '.repeat(marker.length);
        const body = [
            ...t.detail.split('\n'),
            ...(t.files.length ? ['Files: ' + t.files.map((f) => '`' + f + '`').join(', ')] : []),
        ].map((line) => (line ? pad + line : ''));
        return [`${marker}[${t.done ? 'x' : ' '}] **${t.title}**`, ...body].join('\n');
    };
    return [
        plan.summary,
        '## Steps\n\n' + plan.tasks.map(step).join('\n\n'),
        ...SECTION_KEYS
            .filter((k) => plan[k].length)
            .map((k) => `## ${SECTIONS[k]}\n\n` + plan[k].map((s) => '- ' + s).join('\n')),
    ]
        .filter(Boolean)
        .join('\n\n');
}
export class PlansViewModel {
    trace: Trace | null = null;
    isOpen = false;
    busy = false;
    status = '';
    error = false;
    /** The Copy button reads "Copied!" for a moment. */
    readonly copied = new CopyFeedback();
    /** Done steps show only their title unless opened here (by index). */
    readonly expanded = new Set<number>();
    /** The lists after the steps start closed. */
    readonly openSections = new Set<PlanSection>();
    /** Steps start open. */
    stepsClosed = false;
    private controller: AbortController | null = null;
    private disposed = false;
    constructor(readonly deps: PlanDependencies) {
        makeAutoObservable<this, 'controller' | 'disposed'>(
            this,
            { deps: false, copied: false, trace: observableRef, controller: false, disposed: false },
            { autoBind: true }
        );
    }
    get plan() {
        return this.trace?.plan;
    }
    isGenerating(trace: Trace) {
        return this.busy && this.isSame(trace);
    }
    private isSame(trace: Trace) {
        // A library row (`key`) and the open trace (`_doc`) are different copies of one saved trace.
        const id = (t: Trace) => t._doc || t.key;
        return !!this.trace && (this.trace === trace || (!!id(trace) && id(trace) === id(this.trace)));
    }
    private resetFolds() {
        this.expanded.clear();
        this.openSections.clear();
        this.stepsClosed = false;
    }
    setStepsOpen(open: boolean) {
        this.stepsClosed = !open;
    }
    /** Ticked steps out of all steps. */
    get progress() {
        const tasks = this.plan?.tasks ?? [];
        return { done: tasks.filter((t) => t.done).length, total: tasks.length };
    }
    isSectionOpen(k: PlanSection) {
        return this.openSections.has(k);
    }
    setSectionOpen(k: PlanSection, open: boolean) {
        if (open) this.openSections.add(k);
        else this.openSections.delete(k);
    }
    async open(trace: Trace) {
        // Reopening a plan that is still generating just shows it again.
        if (this.isGenerating(trace)) {
            this.isOpen = true;
            return;
        }
        this.stop();
        // reopening the same plan keeps what was unfolded
        if (!this.isSame(trace)) this.resetFolds();
        this.trace = trace;
        this.isOpen = true;
        this.status = '';
        this.error = false;
        if (!trace.plan) await this.generatePlan();
    }
    // Closing hides the modal; generation keeps running until Stop.
    close() {
        this.isOpen = false;
    }
    stop() {
        this.controller?.abort();
        this.controller = null;
        this.busy = false;
        this.status = 'Stopped. You can retry.';
    }
    async generatePlan() {
        if (this.busy || !this.trace || !this.deps.repo.aiAvailable || this.disposed) return;
        const trace = this.trace,
            ctl = new AbortController();
        this.controller = ctl;
        this.busy = true;
        this.status = 'Preparing implementation plan…';
        this.error = false;
        const active = () =>
            !this.disposed &&
            !ctl.signal.aborted &&
            this.controller === ctl &&
            this.trace === trace;
        try {
            const result = await this.deps.services.api.stream<StreamResult>(
                '/api/plan',
                { trace: plain(trace), ...this.deps.getPick() },
                ctl.signal,
                (text) => {
                    if (active())
                        runInAction(() => {
                            this.status = text;
                        });
                }
            );
            if (!active()) return;
            const plan = normalizePlan(result?.plan) as Plan | null;
            if (!plan)
                throw new Error('The AI tool answered without a usable implementation plan.');
            runInAction(() => {
                trace.plan = plan;
                this.resetFolds();
            });
            await this.deps.saveTrace(trace);
            if (active())
                runInAction(() => {
                    this.status = 'Plan ready.' + spend(result);
                });
        } catch (error) {
            if (active())
                runInAction(() => {
                    this.status =
                        error instanceof Error
                            ? error.message
                            : "Couldn't generate the plan. Try again.";
                    this.error = true;
                });
        } finally {
            if (this.controller === ctl)
                runInAction(() => {
                    this.controller = null;
                    this.busy = false;
                });
        }
    }
    isExpanded(i: number) {
        return this.expanded.has(i);
    }
    toggleExpanded(i: number) {
        if (this.expanded.has(i)) this.expanded.delete(i);
        else this.expanded.add(i);
    }
    /** Ticks a step on or off and saves it with the trace. */
    async toggleDone(i: number) {
        const trace = this.trace,
            task = trace?.plan?.tasks[i];
        if (!trace || !task || this.busy) return;
        if (task.done) delete task.done;
        else task.done = true;
        this.expanded.delete(i);
        try {
            await this.deps.saveTrace(trace);
        } catch {
            if (!this.disposed && this.trace === trace)
                runInAction(() => {
                    this.status = "Couldn't save the step. Try again.";
                    this.error = true;
                });
        }
    }
    async copy() {
        if (!this.plan) return;
        try {
            await this.deps.services.browser.copy(planMarkdown(this.plan));
            if (!this.disposed) this.copied.flash();
        } catch {
            if (!this.disposed)
                runInAction(() => {
                    this.status = "Couldn't copy to the clipboard.";
                });
        }
    }
    dispose() {
        this.disposed = true;
        this.copied.dispose();
        this.stop();
    }
}

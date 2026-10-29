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
export function planText(plan: Plan) {
    return [
        plan.summary,
        ...plan.tasks.map(
            (t, i) =>
                `${i + 1}. ${t.title}\n${t.detail}${t.files.length ? '\nFiles: ' + t.files.join(', ') : ''}`
        ),
        ...(['interfaces', 'tests', 'risks', 'questions'] as const)
            .filter((k) => plan[k].length)
            .map(
                (k) =>
                    ({
                        interfaces: 'Interface changes',
                        tests: 'Tests',
                        risks: 'Risks',
                        questions: 'Open questions',
                    })[k] +
                    '\n' +
                    plan[k].map((s) => '- ' + s).join('\n')
            ),
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
        // A library row (`key`) and the open trace (`_doc`) are different copies of one saved trace.
        const id = (t: Trace) => t._doc || t.key;
        return this.busy && !!this.trace && (this.trace === trace || (!!id(trace) && id(trace) === id(this.trace)));
    }
    async open(trace: Trace) {
        // Reopening a plan that is still generating just shows it again.
        if (this.isGenerating(trace)) {
            this.isOpen = true;
            return;
        }
        this.stop();
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
    async copy() {
        if (!this.plan) return;
        try {
            await this.deps.services.browser.copy(planText(this.plan));
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

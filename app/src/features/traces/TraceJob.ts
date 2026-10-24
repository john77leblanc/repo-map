import { makeAutoObservable, observableRef } from 'mobx';
import type { AgentPick, Trace, Workspace } from '../../models/types';

let nextJob = 0;

/** One browser-session generation, independent of whether its modal is open. */
class TraceJob {
    readonly id = `trace-job-${Date.now()}-${++nextJob}`;
    readonly createdAt = Date.now();
    readonly controller = new AbortController();
    title = '';
    status = '';
    error = false;
    state: 'running' | 'saving' | 'completed' | 'failed' | 'stopped' = 'running';
    result: Trace | null = null;
    saveFailed = false;
    ticker: ReturnType<typeof setInterval> | null = null;

    constructor(
        readonly prompt: string,
        readonly outputs: Trace['outputs'],
        readonly pick: AgentPick,
        readonly agentLabel: string,
        readonly workspace: Workspace
    ) {
        makeAutoObservable(this, {
            controller: false,
            ticker: false,
            result: observableRef,
        }, { autoBind: true });
    }

    get busy() {
        return this.state === 'running' || this.state === 'saving';
    }

    clearTicker() {
        if (this.ticker !== null) clearInterval(this.ticker);
        this.ticker = null;
    }
}

export { TraceJob };

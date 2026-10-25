import { makeAutoObservable } from 'mobx';

export interface ProgressEntry {
    text: string;
    /** Milliseconds since the log started. */
    at: number;
}
const MAX_ENTRIES = 200;

/** Progress messages from one job, so the UI can show the latest line and the history. */
export class ProgressLog {
    entries: ProgressEntry[] = [];
    private started = 0;
    constructor(private readonly now: () => number = () => Date.now()) {
        makeAutoObservable<this, 'now' | 'started'>(this, { now: false, started: false }, { autoBind: true });
    }
    get last() {
        return this.entries.length ? this.entries[this.entries.length - 1].text : '';
    }
    /** Clear and start timing a new job, optionally with its first line. */
    start(text = '') {
        this.started = this.now();
        this.entries = [];
        if (text) this.push(text);
    }
    push(text: string) {
        const t = String(text || '').trim();
        if (!t || t === this.last) return;
        if (!this.started) this.started = this.now();
        this.entries.push({ text: t, at: this.now() - this.started });
        if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    }
    clear() {
        this.entries = [];
        this.started = 0;
    }
}

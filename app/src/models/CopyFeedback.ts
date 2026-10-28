import { makeAutoObservable } from 'mobx';

/** How long a copy button reads "Copied!". */
const COPIED_MS = 2000;

/**
 * Short-lived "Copied!" state for copy buttons. `key` tells apart several buttons
 * sharing one model (e.g. one per trace).
 */
export class CopyFeedback {
    key: string | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    constructor() {
        makeAutoObservable<this, 'timer'>(this, { timer: false }, { autoBind: true });
    }
    get copied() {
        return this.key !== null;
    }
    isCopied(key = 'copied') {
        return this.key === key;
    }
    flash(key = 'copied', ms = COPIED_MS) {
        this.clearTimer();
        this.key = key;
        this.timer = setTimeout(() => this.reset(), ms);
    }
    reset() {
        this.clearTimer();
        this.key = null;
    }
    dispose() {
        this.reset();
    }
    private clearTimer() {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
    }
}

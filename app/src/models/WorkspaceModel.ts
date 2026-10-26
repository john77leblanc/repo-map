import { makeAutoObservable, observableRef, runInAction } from 'mobx';
import { ProgressLog } from './ProgressLog';
import type { Seam, WorkspaceFile, WorkspaceRepo, WorkspaceView } from './types';
import type { Services } from '../shared/services/contracts';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const sameSeam = (a: Seam, b: Seam) => a.from === b.from && a.to === b.to;

export interface Badge {
    text: string;
    tone: 'ok' | 'warn' | 'muted';
    title?: string;
}

/** Short freshness badges for one repo: current, map stale, behind main N, snapshot old. */
export function freshnessBadges(repo: WorkspaceRepo): Badge[] {
    if (repo.error) return [{ text: 'unavailable', tone: 'warn', title: repo.error }];
    const f = repo.freshness || {};
    if (f.snapshot) {
        const s = f.snapshot;
        const when = s.exportedAt ? new Date(s.exportedAt).toLocaleDateString() : 'unknown date';
        if (s.state === 'old') return [{ text: 'snapshot old', tone: 'warn', title: `Exported ${when}; the remote has moved on since.` }];
        if (s.state === 'current') return [{ text: 'current', tone: 'ok', title: `Exported ${when}; matches the remote.` }];
        return [{ text: `snapshot ${when}`, tone: 'muted', title: s.state === 'unchecked' ? 'Refresh to compare it with its remote.' : 'This snapshot has no remote to compare with.' }];
    }
    const out: Badge[] = [];
    if (f.map?.state === 'stale') out.push({ text: 'map stale', tone: 'warn', title: `${f.map.changed} file${f.map.changed === 1 ? '' : 's'} changed since the map was drawn.` });
    const r = f.remote;
    const fetched = r?.fetchedAt ? `Last fetched ${new Date(r.fetchedAt).toLocaleString()}.` : 'Never fetched.';
    if (r?.state === 'behind') {
        const branch = (r.branch || 'origin/main').replace(/^origin\//, '');
        out.push({ text: `behind ${branch} ${r.behind}`, tone: 'warn', title: `This checkout is ${r.behind} commit${r.behind === 1 ? '' : 's'} behind ${r.branch}. ${fetched}` });
    }
    if (!out.length) out.push({ text: 'current', tone: 'ok', title: r?.branch ? `Up to date with ${r.branch}. ${fetched}` : 'Map matches this checkout.' });
    return out;
}

/** workspace.json, the merged map and the jobs around them. Shared by the map and Settings. */
export class WorkspaceModel {
    view: WorkspaceView | null = null;
    loaded = false;
    error = '';
    saving = false;
    refreshing: Record<string, boolean> = {};
    repoErrors: Record<string, string> = {};
    readonly seamLog = new ProgressLog();
    seamBusy = false;
    seamError = false;
    proposals: Seam[] = [];
    private seamCtl?: AbortController;
    private disposed = false;
    constructor(readonly services: Services) {
        makeAutoObservable<this, 'seamCtl' | 'disposed'>(this, { services: false, view: observableRef, seamCtl: false, disposed: false }, { autoBind: true });
    }
    get workspace(): WorkspaceFile {
        return this.view?.workspace || { links: [], seams: [] };
    }
    get repos(): WorkspaceRepo[] {
        return this.view?.repos || [];
    }
    /** Is at least one other repo linked and readable? */
    get linked() {
        return this.repos.some((r) => r.name !== 'home' && !r.error);
    }
    get titles(): Record<string, string> {
        return Object.fromEntries(this.repos.map((r) => [r.name, r.title]));
    }
    async load() {
        try {
            const view = await this.services.api.get<WorkspaceView>('/api/workspace');
            runInAction(() => {
                this.view = view;
                this.error = '';
            });
        } catch (e) {
            runInAction(() => {
                this.error = message(e);
            });
        } finally {
            runInAction(() => {
                this.loaded = true;
            });
        }
    }
    /** Save links or seams (fields left out are kept). */
    async save(patch: Partial<WorkspaceFile>) {
        this.saving = true;
        try {
            const view = await this.services.api.request<WorkspaceView>('/api/workspace', { method: 'PUT', body: JSON.stringify(patch) });
            runInAction(() => {
                this.view = view;
                this.error = '';
            });
            return true;
        } catch (e) {
            runInAction(() => {
                this.error = message(e);
            });
            return false;
        } finally {
            runInAction(() => {
                this.saving = false;
            });
        }
    }
    addLink(name: string, dir: string) {
        const links = this.workspace.links.filter((l) => l.name !== name);
        return this.save({ links: [...links, { name: name.trim(), dir: dir.trim() }] });
    }
    /** Unlink a repo, with the seams that pointed into it. */
    removeLink(name: string) {
        const inRepo = (id: string) => id.startsWith(name + ':');
        return this.save({
            links: this.workspace.links.filter((l) => l.name !== name),
            seams: this.workspace.seams.filter((s) => !inRepo(s.from) && !inRepo(s.to)),
        });
    }
    async importSnapshot(name: string, text: string) {
        let snapshot: unknown;
        try {
            snapshot = JSON.parse(text);
        } catch {
            this.error = 'That file isn’t JSON. Pick a file made by `repo-map export`.';
            return false;
        }
        this.saving = true;
        try {
            const view = await this.services.api.request<WorkspaceView>('/api/workspace/import', { method: 'POST', body: JSON.stringify({ name: name.trim(), snapshot }) });
            runInAction(() => {
                this.view = view;
                this.error = '';
            });
            return true;
        } catch (e) {
            runInAction(() => {
                this.error = message(e);
            });
            return false;
        } finally {
            runInAction(() => {
                this.saving = false;
            });
        }
    }
    /** The opt-in `git fetch` (or remote check for a snapshot). */
    async refresh(name: string) {
        if (this.refreshing[name]) return;
        this.refreshing[name] = true;
        this.repoErrors[name] = '';
        try {
            const out = await this.services.api.request<{ freshness: WorkspaceRepo['freshness'] }>('/api/workspace/fetch', { method: 'POST', body: JSON.stringify({ name }) });
            runInAction(() => {
                if (!this.view) return;
                this.view = { ...this.view, repos: this.view.repos.map((r) => (r.name === name ? { ...r, freshness: out.freshness } : r)) };
            });
        } catch (e) {
            runInAction(() => {
                this.repoErrors[name] = message(e);
            });
        } finally {
            runInAction(() => {
                this.refreshing[name] = false;
            });
        }
    }
    /** Ask the AI tool for connections contracts didn't find. Results are proposals until accepted. */
    async findSeams() {
        if (this.seamBusy || this.disposed) return;
        const ctl = new AbortController();
        this.seamCtl = ctl;
        this.seamBusy = true;
        this.seamError = false;
        this.proposals = [];
        this.seamLog.start('Starting…');
        try {
            const result = await this.services.api.stream<{ proposals: Seam[]; spend?: string }>('/api/workspace/seams', {}, ctl.signal, (text) => this.seamLog.push(text));
            if (ctl.signal.aborted || this.disposed) return;
            runInAction(() => {
                this.proposals = result.proposals || [];
                const n = this.proposals.length;
                this.seamLog.push((n ? `Found ${n} possible connection${n === 1 ? '' : 's'}. Accept the ones that are right.` : 'No new connections found.') + (result.spend ? ` · ${result.spend}` : ''));
            });
        } catch (e) {
            if (!this.disposed)
                runInAction(() => {
                    this.seamError = !ctl.signal.aborted;
                    this.seamLog.push(ctl.signal.aborted ? 'Stopped.' : message(e));
                });
        } finally {
            if (!this.disposed)
                runInAction(() => {
                    this.seamBusy = false;
                    this.seamCtl = undefined;
                });
        }
    }
    stopSeams() {
        this.seamCtl?.abort();
    }
    async acceptSeam(seam: Seam) {
        const ok = await this.save({ seams: [...this.workspace.seams.filter((s) => !sameSeam(s, seam)), { ...seam, via: 'ai' }] });
        if (ok) runInAction(() => (this.proposals = this.proposals.filter((s) => !sameSeam(s, seam))));
    }
    dismissSeam(seam: Seam) {
        this.proposals = this.proposals.filter((s) => !sameSeam(s, seam));
    }
    /** Remove a saved AI or manual seam. Contract seams come back while the contracts match. */
    removeSeam(seam: Pick<Seam, 'from' | 'to'>) {
        return this.save({ seams: this.workspace.seams.filter((s) => !(s.from === seam.from && s.to === seam.to)) });
    }
    dispose() {
        this.disposed = true;
        this.seamCtl?.abort();
    }
}

import { makeAutoObservable, runInAction } from 'mobx';
import type { RepositoryModel } from '../../models/RepositoryModel';
import type { Services } from '../../shared/services/contracts';
import type { JobResult, SettingsViewModel } from '../settings/SettingsViewModel';
import type { SitemapViewModel } from '../sitemap/SitemapViewModel';

export type JobState = 'idle' | 'running' | 'done' | 'error';
export interface StartDeps {
    repo: RepositoryModel;
    services: Services;
    settings: SettingsViewModel;
    sitemap: SitemapViewModel;
}
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const plural = (n = 0, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * First-run screen: build the map (and, if asked, the sitemap) in parallel
 * with the map's AI settings. The sitemap half reuses SitemapViewModel so its
 * progress also shows in the Sitemap tab once the map opens.
 */
export class StartViewModel {
    includeSitemap = false;
    mapState: JobState = 'idle';
    mapMessage = '';
    starting = false;
    folderError = '';
    /** The user chose to open the map while the sitemap is still running. */
    dismissed = false;
    private sitemapStarted = false;
    private mapCtl?: AbortController;
    private disposed = false;
    constructor(readonly deps: StartDeps) {
        makeAutoObservable<this, 'mapCtl' | 'disposed'>(this, { deps: false, mapCtl: false, disposed: false }, { autoBind: true });
    }
    get sitemapState(): JobState {
        if (!this.sitemapStarted) return 'idle';
        const s = this.deps.sitemap;
        return s.busy ? 'running' : s.error ? 'error' : s.sitemap ? 'done' : 'idle';
    }
    get sitemapMessage() {
        return this.sitemapStarted ? this.deps.sitemap.message : '';
    }
    get running() {
        return this.mapState === 'running' || this.sitemapState === 'running';
    }
    get hasMap() {
        return this.deps.repo.map.nodes.length > 0;
    }
    /** Shown until a map exists and nothing started here is still running. */
    get visible() {
        return this.deps.repo.ready && !this.dismissed && (!this.hasMap || this.running);
    }
    get noAi() {
        return this.deps.settings.data ? this.deps.settings.noAi : '';
    }
    get canBuild() {
        return !!this.deps.settings.data && !this.noAi && !this.running && !this.starting && !this.deps.settings.saving;
    }
    setIncludeSitemap(value: boolean) {
        this.includeSitemap = value;
    }
    async build() {
        if (!this.canBuild) return;
        this.starting = true;
        try {
            const jobs: Promise<unknown>[] = [];
            if (!this.hasMap) jobs.push(this.buildMap());
            if (this.includeSitemap) {
                this.sitemapStarted = true;
                jobs.push(this.deps.sitemap.generate());
            }
            await Promise.all(jobs);
        } finally {
            if (!this.disposed) runInAction(() => { this.starting = false; });
        }
    }
    retryMap() {
        if (this.mapState === 'running' || this.noAi) return;
        void this.buildMap();
    }
    retrySitemap() {
        if (this.sitemapState === 'running' || this.noAi) return;
        this.sitemapStarted = true;
        void this.deps.sitemap.generate();
    }
    private async buildMap() {
        const ctl = new AbortController();
        this.mapCtl = ctl;
        this.mapState = 'running';
        this.mapMessage = 'Starting…';
        try {
            const result = await this.deps.services.api.stream<JobResult>('/api/map/generate', {}, ctl.signal, (text) => {
                if (!this.disposed && ctl === this.mapCtl) runInAction(() => { this.mapMessage = text; });
            });
            if (this.disposed || ctl !== this.mapCtl || ctl.signal.aborted) return;
            if (!result) throw new Error('The map job ended without an answer.');
            const counts = result.check?.counts;
            runInAction(() => {
                this.mapState = 'done';
                this.mapMessage = `Map drawn: ${plural(counts?.nodes, 'card')}, ${plural(counts?.edges, 'connection')}.` +
                    (result.docsError ? ' Couldn’t link docs: ' + result.docsError : '');
            });
            await Promise.all([this.deps.repo.load(), this.deps.settings.loadMapStatus()]);
        } catch (e) {
            if (!this.disposed && ctl === this.mapCtl)
                runInAction(() => {
                    this.mapState = ctl.signal.aborted ? 'idle' : 'error';
                    this.mapMessage = ctl.signal.aborted ? 'Stopped.' : message(e);
                });
        } finally {
            if (ctl === this.mapCtl) this.mapCtl = undefined;
        }
    }
    stopMap() {
        this.mapCtl?.abort();
    }
    stopSitemap() {
        this.deps.sitemap.stop();
    }
    /** Leave the screen once the map exists; a running sitemap keeps going in its tab. */
    openMap() {
        if (this.hasMap) this.dismissed = true;
    }
    async useFolders() {
        if (this.running || this.starting) return;
        this.starting = true;
        this.folderError = '';
        try {
            await this.deps.services.api.request('/api/map/starter', { method: 'POST' });
            await Promise.all([this.deps.repo.load(), this.deps.settings.loadMapStatus()]);
        } catch (e) {
            if (!this.disposed) runInAction(() => { this.folderError = message(e); });
        } finally {
            if (!this.disposed) runInAction(() => { this.starting = false; });
        }
    }
    dispose() {
        this.disposed = true;
        this.mapCtl?.abort();
    }
}

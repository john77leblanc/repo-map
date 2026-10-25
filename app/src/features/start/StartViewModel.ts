import { makeAutoObservable, runInAction } from 'mobx';
import { ProgressLog } from '../../models/ProgressLog';
import type { RepositoryModel } from '../../models/RepositoryModel';
import type { Services } from '../../shared/services/contracts';
import type { JobResult, SettingsViewModel } from '../settings/SettingsViewModel';
import type { SitemapViewModel } from '../sitemap/SitemapViewModel';

export type JobState = 'idle' | 'running' | 'done' | 'error';
export type StartStep = 'project' | 'ai' | 'build';
export const START_STEPS: { id: StartStep; label: string }[] = [
    { id: 'project', label: 'Project' },
    { id: 'ai', label: 'AI tools' },
    { id: 'build', label: 'Build' },
];
/** What GET /api/setup returns. */
export interface SetupInfo {
    name: string;
    codeRoots: string[];
    context: string;
    dirs: { path: string; suggested: boolean }[];
    ollamaInstalled?: boolean;
}
const folder = (value: string) => {
    const v = value.trim().replace(/\\/g, '/').replace(/^\.?\/+/, '');
    return v ? v.replace(/\/?$/, '/') : '';
};
export interface StartDeps {
    repo: RepositoryModel;
    services: Services;
    settings: SettingsViewModel;
    sitemap: SitemapViewModel;
}
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const plural = (n = 0, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * First-run onboarding in three steps: project details (name, code folders,
 * description), AI tools (traces, and optionally a different one for the map),
 * then building the map (and, if asked, the sitemap) in parallel. The sitemap
 * half reuses SitemapViewModel so its progress also shows in the Sitemap tab
 * once the map opens.
 */
export class StartViewModel {
    step: StartStep = 'project';
    setup: SetupInfo | null = null;
    setupLoading = false;
    name = '';
    roots: string[] = [];
    context = '';
    customFolder = '';
    stepError = '';
    saving = false;
    includeSitemap = false;
    mapState: JobState = 'idle';
    /** Progress of the map build; the latest line is shown, the rest on demand. */
    readonly mapLog = new ProgressLog();
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
    get mapMessage() {
        return this.mapLog.last;
    }
    get sitemapLog() {
        return this.deps.sitemap.log;
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
    get stepIndex() {
        return START_STEPS.findIndex((s) => s.id === this.step);
    }
    /** Folder choices: the repo's top-level folders plus any typed in or already configured. */
    get folderOptions() {
        const listed = this.setup?.dirs.map((d) => d.path) || [];
        return [...new Set([...listed, ...this.roots])];
    }
    get canSaveProject() {
        return !!this.name.trim() && this.roots.length > 0 && !this.saving;
    }
    /** The map uses the trace tool unless a separate pick is saved for it. */
    get sameForMap() {
        return !this.deps.settings.mapPick;
    }
    get canGoBack() {
        return this.stepIndex > 0 && !this.running && !this.starting && !this.saving;
    }
    async loadSetup() {
        if (this.setup || this.setupLoading) return;
        this.setupLoading = true;
        try {
            const info = await this.deps.services.api.get<SetupInfo>('/api/setup');
            if (this.disposed) return;
            runInAction(() => {
                this.setup = info;
                this.name = info.name;
                this.roots = [...info.codeRoots];
                this.context = info.context;
            });
        } catch (e) {
            if (!this.disposed) runInAction(() => { this.stepError = message(e); });
        } finally {
            if (!this.disposed) runInAction(() => { this.setupLoading = false; });
        }
    }
    setName(value: string) {
        this.name = value;
    }
    setContext(value: string) {
        this.context = value;
    }
    setCustomFolder(value: string) {
        this.customFolder = value;
    }
    toggleRoot(path: string, on: boolean) {
        this.roots = on ? [...new Set([...this.roots, path])] : this.roots.filter((r) => r !== path);
    }
    addFolder() {
        const f = folder(this.customFolder);
        if (!f) return;
        this.toggleRoot(f, true);
        this.customFolder = '';
    }
    /** Step 1 → 2: save the project details to config.json. */
    async saveProject() {
        if (!this.canSaveProject) return;
        this.saving = true;
        this.stepError = '';
        try {
            await this.deps.services.api.request('/api/setup', {
                method: 'PUT',
                body: JSON.stringify({ name: this.name.trim(), codeRoots: this.roots, context: this.context.trim() }),
            });
            await this.deps.repo.load();
            if (!this.disposed) runInAction(() => { this.step = 'ai'; });
        } catch (e) {
            if (!this.disposed) runInAction(() => { this.stepError = message(e); });
        } finally {
            if (!this.disposed) runInAction(() => { this.saving = false; });
        }
    }
    setSameForMap(same: boolean) {
        const settings = this.deps.settings;
        void settings.setMapPick(same ? null : { ...(settings.tracePick || settings.data?.default || {}) });
    }
    /** Step 2 → 3: save the trace tool as this person's default. */
    async saveAi() {
        const settings = this.deps.settings;
        if (this.saving || settings.saving) return;
        if (!settings.available || !settings.tracePick?.agent) {
            this.skipAi();
            return;
        }
        this.saving = true;
        this.stepError = '';
        try {
            await settings.saveTraceDefault(settings.tracePick);
            if (!this.disposed) runInAction(() => { this.step = 'build'; });
        } catch (e) {
            if (!this.disposed) runInAction(() => { this.stepError = 'Couldn’t save the AI tool: ' + message(e); });
        } finally {
            if (!this.disposed) runInAction(() => { this.saving = false; });
        }
    }
    /** Go on without an AI tool: the build step then offers the folder map. */
    skipAi() {
        this.stepError = '';
        this.step = 'build';
    }
    back() {
        if (!this.canGoBack) return;
        this.stepError = '';
        this.step = START_STEPS[this.stepIndex - 1].id;
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
        this.mapLog.start('Starting…');
        try {
            const result = await this.deps.services.api.stream<JobResult>('/api/map/generate', {}, ctl.signal, (text) => {
                if (!this.disposed && ctl === this.mapCtl) this.mapLog.push(text);
            });
            if (this.disposed || ctl !== this.mapCtl || ctl.signal.aborted) return;
            if (!result) throw new Error('The map job ended without an answer.');
            const counts = result.check?.counts;
            runInAction(() => {
                this.mapState = 'done';
                this.mapLog.push(`Map drawn: ${plural(counts?.nodes, 'card')}, ${plural(counts?.edges, 'connection')}.` +
                    (result.docsError ? ' Couldn’t link docs: ' + result.docsError : ''));
            });
            await Promise.all([this.deps.repo.load(), this.deps.settings.loadMapStatus()]);
        } catch (e) {
            if (!this.disposed && ctl === this.mapCtl)
                runInAction(() => {
                    this.mapState = ctl.signal.aborted ? 'idle' : 'error';
                    this.mapLog.push(ctl.signal.aborted ? 'Stopped.' : message(e));
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

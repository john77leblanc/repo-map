import { makeAutoObservable, runInAction } from 'mobx';
import type { RepositoryModel } from '../../models/RepositoryModel';
import type { AgentData, AgentPick } from '../../models/types';
import type { Services } from '../../shared/services/contracts';
import { ProgressLog } from '../../models/ProgressLog';
import type { WorkspaceModel } from '../../models/WorkspaceModel';
import type { SitemapViewModel } from '../sitemap/SitemapViewModel';
import type { ComponentsViewModel } from '../components/ComponentsViewModel';

export interface Catalog extends Omit<AgentData, 'default'> {
    default?: AgentPick | null;
    generateSet?: boolean;
    generateReason?: string;
}
export interface MapStatus {
    state: 'current' | 'stale' | 'unrecorded' | 'unknown' | 'starter' | 'empty' | 'nogit';
    head?: string;
    evaluatedAt?: string;
    commitsNotInHead?: number;
    commit?: string;
    reason?: string;
    changed?: number;
    files?: string[];
    commitsSince?: number;
    tooBig?: boolean;
    job?: JobKind | null;
    sitemapJob?: 'sitemap' | 'components' | null;
    updating?: boolean;
    docs?: {
        linked?: boolean;
        changed?: number;
        files?: string[];
        commit?: string | null;
        generatedAt?: string | null;
    };
}
export type JobKind = 'update' | 'generate' | 'docs';
/** A root view that Settings → Map → Views can redraw. */
export type RootView = 'map' | 'sitemap' | 'components';
/** The collapsible Settings groups. */
export type SettingsSectionId = 'map' | 'agents' | 'links';
export interface SettingsDeps {
    repo: RepositoryModel;
    services: Services;
    onAvailabilityChange?: (available: boolean) => void;
    onJobComplete?: (kind: JobKind, result: JobResult) => void;
    /** Linked repos, edited in the Linked repos section. */
    workspace?: WorkspaceModel;
    /** The repository sitemap and component map, redrawn from Views. */
    sitemap?: SitemapViewModel;
    components?: ComponentsViewModel;
}
interface Counts {
    links?: number;
    cards?: number;
    nodes?: number;
    edges?: number;
    added?: number;
    updated?: number;
    removed?: number;
}
export interface JobResult {
    counts?: Counts;
    check?: { counts?: Counts };
    docs?: { counts: Counts };
    docsError?: string;
    summary?: string;
    cost?: number;
    tokens?: number;
    spend?: string;
}
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const plural = (n = 0, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
export function mapNoticeKey(st: MapStatus | null) {
    if (!st) return '';
    const d = st.docs || {},
        docsIssue = !['starter', 'empty'].includes(st.state) && (!d.linked || !!d.changed);
    if (
        !['stale', 'unrecorded', 'unknown', 'starter', 'empty', 'nogit'].includes(st.state) &&
        !docsIssue
    )
        return '';
    return JSON.stringify({
        state: st.state,
        commit: st.commit || '',
        reason: st.reason || '',
        changed: st.changed || 0,
        files: st.files || [],
        docs: docsIssue
            ? {
                  linked: !!d.linked,
                  changed: d.changed || 0,
                  files: d.files || [],
                  commit: d.commit || '',
              }
            : null,
    });
}
export class SettingsViewModel {
    data: Catalog | null = null;
    tracePick: AgentPick | null = null;
    mapPick: AgentPick | null = null;
    mapStatus: MapStatus | null = null;
    loading = false;
    catalogError = '';
    saveStatus = '';
    saveError = false;
    saving = false;
    jobStatus = '';
    /** Progress of the running map job; jobStatus shows its latest line with the elapsed time. */
    readonly jobLog = new ProgressLog();
    jobError = false;
    busy = false;
    /** The map job running (or last run). */
    jobKind: JobKind | null = null;
    /** A redraw that replaces an existing view asks once more: the view whose button reads "Confirm". */
    armed: RootView | null = null;
    dismissed = '';
    /** Settings tab shown; kept between openings so Settings reopens where it was left. */
    activeTab: SettingsSectionId = 'map';
    /** Tab the view should focus once, set by reveal(). */
    revealed: SettingsSectionId | null = null;
    traceDefaultStatus = '';
    traceDefaultError = false;
    savingDefault = false;
    private disposed = false;
    private catalogCtl?: AbortController;
    private statusCtl?: AbortController;
    private saveCtl?: AbortController;
    private jobCtl?: AbortController;
    private markCtl?: AbortController;
    private armTimer?: ReturnType<typeof setTimeout>;
    private reloadTimer?: ReturnType<typeof setTimeout>;
    private tick?: ReturnType<typeof setInterval>;
    constructor(readonly deps: SettingsDeps) {
        makeAutoObservable(this, { deps: false }, { autoBind: true });
    }
    get redrawArmed() {
        return this.armed === 'map';
    }
    /** First click arms the view's redraw for 3s; returns true when the redraw should run now. */
    private confirm(view: RootView, exists: boolean) {
        if (exists && this.armed !== view) {
            clearTimeout(this.armTimer);
            this.armed = view;
            this.armTimer = setTimeout(() => runInAction(() => { if (this.armed === view) this.armed = null; }), 3000);
            return false;
        }
        clearTimeout(this.armTimer);
        this.armed = null;
        return true;
    }
    /** Views → Sitemap: generate, or regenerate after a confirm. */
    redrawSitemap() {
        const sitemap = this.deps.sitemap;
        if (!sitemap || sitemap.busy || sitemap.loading) return;
        if (this.confirm('sitemap', !!sitemap.sitemap)) void sitemap.generate();
    }
    /** Views → Components: generate, or regenerate after a confirm (needs the sitemap). */
    redrawComponents() {
        const components = this.deps.components;
        if (!components || components.busy || components.loading || !components.canGenerate) return;
        if (this.confirm('components', !!components.components)) void components.generate();
    }
    /** Refresh what the Views rows say (the sitemap and component map load lazily). */
    loadViews() {
        void this.deps.sitemap?.load();
        void this.deps.components?.load();
    }
    get repositoryDetails() {
        const { bootstrap, map } = this.deps.repo;
        const info = bootstrap?.repo;
        const label = (count: number, word: string) => count === 1 || /s$/.test(word) ? word
            : /[^aeiou]y$/.test(word) ? word.slice(0, -1) + 'ies' : word + 's';
        const services = map.nodes.filter((node) => node.kind === 'service').length;
        const topics = map.nodes.filter((node) => node.kind === 'topic').length;
        return {
            name: info?.github || 'local repo',
            counts: services + ' ' + label(services, bootstrap?.config.kinds?.service || 'service') + ' \u00b7 ' +
                topics + ' ' + label(topics, bootstrap?.config.kinds?.topic || 'topic') + ' \u00b7 ' +
                map.edges.length + ' ' + label(map.edges.length, 'connection'),
            revision: 'reading ' + (info?.branch || 'detached HEAD') + (info?.sha ? ' @ ' + info.sha.slice(0, 9) : '') +
                (info?.dirty ? ' (uncommitted changes)' : ''),
        };
    }
    setTab(id: SettingsSectionId) {
        this.activeTab = id;
    }
    /** Show a tab and ask the view to focus it. */
    reveal(id: SettingsSectionId) {
        this.activeTab = id;
        this.revealed = id;
    }
    clearRevealed() {
        this.revealed = null;
    }
    get available() {
        return !!this.data && !this.data.off && this.data.agents.some((a) => a.available);
    }
    get notice() {
        const key = mapNoticeKey(this.mapStatus);
        return !!key && key !== this.dismissed;
    }
    get hasMap() {
        return !!this.mapStatus && !['starter', 'empty'].includes(this.mapStatus.state);
    }
    get noAi() {
        return this.data && !this.data.generate
            ? this.data.generateReason || 'Needs an AI tool: run repo-map doctor'
            : '';
    }
    get serverBusy() {
        return !!this.mapStatus?.job || !!this.mapStatus?.updating;
    }
    get jobsDisabled() {
        return this.busy || this.serverBusy || !!this.noAi;
    }
    choiceLabel(p: AgentPick | null | undefined) {
        const a = this.data?.agents.find((a) => a.id === p?.agent && a.available);
        return a
            ? [a.label, p?.model || a.defaultModel, p?.effort].filter(Boolean).join(' · ')
            : '';
    }
    pickLabel() {
        return this.choiceLabel(this.tracePick) || this.deps.repo.bootstrap?.ai.label || 'AI tool';
    }
    currentPick(): AgentPick {
        const p = this.tracePick;
        return p && this.data?.agents.some((a) => a.id === p.agent && a.available) ? { ...p } : {};
    }
    async init() {
        if (!this.deps.repo.ready) await this.deps.repo.load();
        if (this.disposed || !this.deps.repo.ready) return;
        runInAction(() => {
            this.dismissed =
                this.deps.services.storage.getRaw(
                    this.deps.repo.namespace + 'dismissed-map-notice'
                ) || '';
        });
        await Promise.all([this.loadCatalog(), this.loadMapStatus()]);
    }
    async loadCatalog(refresh = false) {
        if (this.disposed) return;
        this.catalogCtl?.abort();
        const ctl = new AbortController();
        this.catalogCtl = ctl;
        this.loading = true;
        try {
            const data = await this.deps.services.api.get<Catalog>(
                '/api/agents' + (refresh ? '?refresh=1' : ''),
                ctl.signal
            );
            if (this.disposed || ctl !== this.catalogCtl) return;
            runInAction(() => {
                const first = !this.data;
                this.data = data;
                this.catalogError = '';
                if (
                    first ||
                    !data.agents.some((a) => a.available && a.id === this.tracePick?.agent)
                ) {
                    const saved = this.deps.services.storage.get<AgentPick | null>(
                        this.deps.repo.namespace + 'pick',
                        null
                    );
                    this.tracePick =
                        saved && data.agents.some((a) => a.available && a.id === saved.agent)
                            ? saved
                            : data.default ||
                              (data.agents.find((a) => a.available)
                                  ? { agent: data.agents.find((a) => a.available)!.id }
                                  : null);
                }
                this.tracePick = this.normalizePick(this.tracePick);
                if (first)
                    this.mapPick = data.generateSet && data.generate ? { ...data.generate } : null;
                if (!data.generate && data.generateReason && !this.saveStatus) {
                    this.saveStatus = data.generateReason;
                    this.saveError = true;
                }
                this.deps.repo.setAiAvailable(this.available);
                this.deps.onAvailabilityChange?.(this.available);
            });
        } catch (e) {
            if (!this.disposed && ctl === this.catalogCtl && !ctl.signal.aborted)
                runInAction(() => {
                    this.catalogError = message(e);
                });
        } finally {
            if (!this.disposed && ctl === this.catalogCtl)
                runInAction(() => {
                    this.loading = false;
                });
        }
    }
    normalizePick(pick: AgentPick | null): AgentPick | null {
        if (!pick) return null;
        const agent = this.data?.agents.find((a) => a.available && a.id === pick.agent);
        const efforts =
            agent?.models.find((m) => m.id === (pick.model || agent.defaultModel))?.efforts ||
            agent?.efforts ||
            [];
        return { ...pick, effort: efforts.includes(pick.effort || '') ? pick.effort : '' };
    }
    setTracePick(pick: AgentPick | null) {
        this.tracePick = this.normalizePick(pick);
        this.deps.services.storage.set(this.deps.repo.namespace + 'pick', this.tracePick);
    }
    /** Make `pick` this person's default trace tool in every repo (~/.config/repo-map/ai.json). */
    async saveTraceDefault(pick: AgentPick) {
        this.setTracePick(pick);
        await this.deps.services.api.request('/api/settings/trace', {
            method: 'PUT',
            body: JSON.stringify(this.tracePick || {}),
        });
        await this.loadCatalog(true);
    }
    /** Settings → Trace agent: save the current pick as the default for every repo. */
    async useTraceEverywhere() {
        const pick = this.currentPick();
        if (!pick.agent || this.savingDefault || this.disposed) return;
        this.savingDefault = true;
        this.traceDefaultError = false;
        this.traceDefaultStatus = 'Saving…';
        try {
            await this.saveTraceDefault(pick);
            if (!this.disposed)
                runInAction(() => {
                    this.traceDefaultStatus = 'Default for every repo: ' + this.choiceLabel(pick) + '.';
                });
        } catch (e) {
            if (!this.disposed)
                runInAction(() => {
                    this.traceDefaultError = true;
                    this.traceDefaultStatus = 'Couldn’t save: ' + message(e);
                });
        } finally {
            if (!this.disposed)
                runInAction(() => {
                    this.savingDefault = false;
                });
        }
    }
    async setMapPick(pick: AgentPick | null) {
        if (this.disposed) return;
        this.mapPick = pick;
        this.saveCtl?.abort();
        const ctl = new AbortController();
        this.saveCtl = ctl;
        this.saving = true;
        this.saveError = false;
        this.saveStatus = 'Saving…';
        try {
            await this.deps.services.api.request('/api/settings/generate', {
                method: 'PUT',
                body: JSON.stringify(pick || {}),
                signal: ctl.signal,
            });
            if (this.disposed || ctl !== this.saveCtl) return;
            runInAction(() => {
                this.saveStatus = pick
                    ? 'Saved for you in this repo: ' + this.choiceLabel(pick) + '.'
                    : 'The map uses the same tool as traces.';
            });
            await this.loadCatalog(true);
        } catch (e) {
            if (!this.disposed && ctl === this.saveCtl && !ctl.signal.aborted)
                runInAction(() => {
                    this.saveError = true;
                    this.saveStatus = 'Couldn’t save: ' + message(e);
                });
        } finally {
            if (!this.disposed && ctl === this.saveCtl)
                runInAction(() => {
                    this.saving = false;
                });
        }
    }
    async loadMapStatus() {
        if (this.disposed) return;
        this.statusCtl?.abort();
        const ctl = new AbortController();
        this.statusCtl = ctl;
        try {
            const st = await this.deps.services.api.get<MapStatus>('/api/map/status', ctl.signal);
            if (!this.disposed && ctl === this.statusCtl)
                runInAction(() => {
                    this.mapStatus = st;
                    if (!mapNoticeKey(st)) {
                        this.dismissed = '';
                        this.deps.services.storage.setRaw(
                            this.deps.repo.namespace + 'dismissed-map-notice',
                            ''
                        );
                    }
                });
        } catch {
            /* Keep the last known status. */
        }
    }
    dismissNotice() {
        this.dismissed = mapNoticeKey(this.mapStatus);
        this.deps.services.storage.setRaw(
            this.deps.repo.namespace + 'dismissed-map-notice',
            this.dismissed
        );
    }
    async markCurrent() {
        if (this.busy || this.serverBusy || this.disposed) return;
        this.markCtl?.abort();
        const ctl = new AbortController();
        this.markCtl = ctl;
        try {
            await this.deps.services.api.request('/api/map/mark', {
                method: 'POST',
                signal: ctl.signal,
            });
            if (!this.disposed && ctl === this.markCtl) await this.loadMapStatus();
        } catch (e) {
            if (!this.disposed && ctl === this.markCtl && !ctl.signal.aborted)
                runInAction(() => {
                    this.jobError = true;
                    this.jobStatus = message(e);
                });
        }
    }
    redraw() {
        if (this.jobsDisabled) return;
        if (this.confirm('map', this.hasMap)) void this.runJob('generate');
    }
    stopJob() {
        this.jobCtl?.abort();
    }
    async runJob(kind: JobKind) {
        if (this.disposed || this.jobsDisabled || (kind === 'update' && this.mapStatus?.tooBig))
            return;
        const ctl = new AbortController();
        this.jobCtl = ctl;
        this.busy = true;
        this.jobKind = kind;
        this.jobError = false;
        const start = Date.now();
        let last = 'Starting…';
        this.jobLog.start(last);
        const update = () => {
            if (!this.disposed && this.jobCtl === ctl)
                runInAction(() => {
                    this.jobStatus = `${last} · ${Math.round((Date.now() - start) / 1000)}s`;
                });
        };
        update();
        this.tick = setInterval(update, 1000);
        try {
            const result = await this.deps.services.api.stream<JobResult>(
                {
                    update: '/api/map/update',
                    generate: '/api/map/generate',
                    docs: '/api/docs/link',
                }[kind],
                {},
                ctl.signal,
                (text) => {
                    last = text;
                    this.jobLog.push(text);
                    update();
                }
            );
            if (this.disposed || ctl !== this.jobCtl || ctl.signal.aborted) return;
            if (!result) throw new Error('The job ended without an answer.');
            runInAction(() => {
                const c = result.counts || {},
                    d = result.docs?.counts;
                const docs = d
                    ? ` Linked ${plural(d.links, 'doc section')} to ${plural(d.cards, 'card')}.`
                    : result.docsError
                      ? ' Couldn’t link docs: ' + result.docsError
                      : '';
                const text =
                    kind === 'update'
                        ? `Map updated: ${c.added || 0} added, ${c.updated || 0} changed, ${c.removed || 0} removed.` +
                          (result.summary ? ' ' + result.summary : '') +
                          docs
                        : kind === 'generate'
                          ? `Map redrawn: ${plural(result.check?.counts?.nodes, 'card')}, ${plural(result.check?.counts?.edges, 'connection')}.` +
                            docs
                          : `Linked ${plural(c.links, 'doc section')} to ${plural(c.cards, 'card')}.`;
                const spend = result.cost
                    ? ' · ' + (result.cost < 0.01 ? '<$0.01' : '$' + result.cost.toFixed(2))
                    : result.tokens
                      ? ' · ' + result.tokens.toLocaleString() + ' tokens'
                      : result.spend
                        ? ' · ' + result.spend
                        : '';
                this.jobStatus = text + spend + ' Reloading…';
                this.jobLog.push(text + spend);
                this.deps.onJobComplete?.(kind, result);
                this.reloadTimer = setTimeout(() => {
                    if (!this.disposed) this.deps.services.browser.reload();
                }, 2200);
            });
        } catch (e) {
            if (!this.disposed && ctl === this.jobCtl)
                runInAction(() => {
                    this.jobError = !ctl.signal.aborted;
                    this.jobStatus = ctl.signal.aborted ? 'Stopped.' : message(e);
                    this.jobLog.push(this.jobStatus);
                });
        } finally {
            if (!this.disposed && ctl === this.jobCtl)
                runInAction(() => {
                    clearInterval(this.tick);
                    this.busy = false;
                    this.jobCtl = undefined;
                });
        }
    }
    dispose() {
        this.disposed = true;
        this.catalogCtl?.abort();
        this.statusCtl?.abort();
        this.saveCtl?.abort();
        this.jobCtl?.abort();
        this.markCtl?.abort();
        clearTimeout(this.armTimer);
        clearTimeout(this.reloadTimer);
        clearInterval(this.tick);
    }
}

import { runInAction, when } from 'mobx';
import { RepositoryModel } from '../models/RepositoryModel';
import { WorkspaceModel } from '../models/WorkspaceModel';
import { ShellViewModel } from '../features/shell/ShellViewModel';
import { SettingsViewModel } from '../features/settings/SettingsViewModel';
import { TraceViewModel } from '../features/traces/TraceViewModel';
import { ArchitectureViewModel } from '../features/architecture/ArchitectureViewModel';
import { FlowchartViewModel } from '../features/flowchart/FlowchartViewModel';
import { PlansViewModel } from '../features/plans/PlansViewModel';
import { ReviewViewModel } from '../features/review/ReviewViewModel';
import { ComposerViewModel } from '../features/compose/ComposerViewModel';
import { SitemapViewModel } from '../features/sitemap/SitemapViewModel';
import { StartViewModel } from '../features/start/StartViewModel';
import { ViewSwitcherViewModel } from '../features/shell/ViewSwitcherViewModel';
import type { Services } from '../shared/services/contracts';
import type { Trace, Workspace } from '../models/types';

/** The only place that wires features together. Construct after repository bootstrap. */
export class Application {
    readonly shell: ShellViewModel;
    readonly settings: SettingsViewModel;
    readonly traces: TraceViewModel;
    readonly architecture: ArchitectureViewModel;
    readonly flowchart: FlowchartViewModel;
    readonly plans: PlansViewModel;
    readonly review: ReviewViewModel;
    readonly composer: ComposerViewModel;
    readonly sitemap: SitemapViewModel;
    readonly start: StartViewModel;
    readonly workspace: WorkspaceModel;
    readonly views: ViewSwitcherViewModel;
    constructor(
        readonly repo: RepositoryModel,
        readonly services: Services
    ) {
        this.sitemap = new SitemapViewModel({ repo, services,
            getPick: () => this.settings.currentPick(), saveTrace: (trace) => this.traces.saveExisting(trace) });
        this.shell = new ShellViewModel({ repo, services, onWorkspaceChange: (workspace) => {
            if (workspace === 'sitemap') void this.sitemap.load();
        }, onOpenSettings: (section) => this.settings.reveal(section) });
        this.workspace = new WorkspaceModel(services);
        this.settings = new SettingsViewModel({ repo, services, workspace: this.workspace });
        this.architecture = new ArchitectureViewModel({ repo, services, workspace: this.workspace });
        this.start = new StartViewModel({ repo, services, settings: this.settings, sitemap: this.sitemap });
        const getPick = () => this.settings.currentPick();
        const saveTrace = (trace: Trace) => this.traces.saveExisting(trace);
        this.plans = new PlansViewModel({ repo, services, getPick, saveTrace });
        this.flowchart = new FlowchartViewModel({
            repo,
            services,
            getPick,
            saveTrace,
            onTraceUpdated: (trace) => this.traces.select(trace, this.shell.workspace),
        });
        this.traces = new TraceViewModel({
            repo,
            services,
            getPick,
            getPickLabel: () => this.settings.pickLabel(),
            getWorkspace: () => this.shell.workspace,
            getScope: () => this.architecture.scope,
            getWorkspaceMap: () => this.workspace.view?.map || null,
            getRepoTitles: () => this.workspace.titles,
            workspaceReady: () => when(() => this.workspace.loaded),
            sitemap: this.sitemap,
            onSelect: (trace, workspace) => this.showTrace(trace, workspace),
            onClear: () => {
                this.flowchart.setTrace(null);
                this.architecture.setTrace(null);
                this.sitemap.setTrace(null);
                this.architecture.setQuery('');
                this.shell.returnToMap();
                this.plans.close();
            },
            onReveal: (id) => this.architecture.inspect(id),
            onOpenPlan: (trace) => {
                void this.plans.open(trace);
            },
            isPlanBusy: (trace) => this.plans.isGenerating(trace),
            onOpenReview: (job) => this.composer.showJob(job),
            onRequestFlow: (trace) => {
                this.traces.select(trace, 'flowchart');
                return this.flowchart.generate(this.traces.selected!);
            },
        });
        this.review = new ReviewViewModel({ repo, traces: this.traces, getPickLabel: () => this.settings.pickLabel() });
        this.composer = new ComposerViewModel({ traces: this.traces, review: this.review });
        this.views = new ViewSwitcherViewModel({
            repo,
            shell: this.shell,
            traces: this.traces,
            architecture: this.architecture,
            flowchart: this.flowchart,
            sitemap: this.sitemap,
            settings: this.settings,
            onNewTrace: () => {
                this.composer.openNew();
                this.shell.expandSidebar();
            },
        });
    }
    private showTrace(trace: Trace, workspace: Workspace) {
        if (this.architecture.trace !== trace) this.architecture.setTrace(trace);
        if (this.flowchart.trace !== trace) this.flowchart.setTrace(trace);
        this.sitemap.setTrace(trace);
        this.architecture.dismiss();
        this.shell.showWorkspace(workspace);
        this.shell.expandSidebar();
    }
    async init() {
        await Promise.all([this.settings.init(), this.traces.init(), this.workspace.load()]);
        // `repo-map review` opens the page with what to review in the query
        const query = this.services.browser.takeQuery?.() || {};
        if (query.review && !this.start.visible) this.composer.fromQuery(query);
    }
    dispose() {
        this.start.dispose();
        this.sitemap.dispose();
        this.traces.dispose();
        this.plans.dispose();
        this.composer.dispose();
        this.review.dispose();
        this.flowchart.dispose();
        this.architecture.dispose();
        this.settings.dispose();
        this.shell.dispose();
        this.workspace.dispose();
    }
}

export async function createApplication(services: Services) {
    const repo = new RepositoryModel(services);
    await repo.load();
    if (!repo.ready) throw new Error(repo.error);
    const app = new Application(repo, services);
    runInAction(() => {
        document.title = repo.bootstrap!.config.name;
    });
    void app.init();
    return app;
}

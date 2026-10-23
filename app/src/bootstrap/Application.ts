import { runInAction } from 'mobx';
import { RepositoryModel } from '../models/RepositoryModel';
import { ShellViewModel } from '../features/shell/ShellViewModel';
import { SettingsViewModel } from '../features/settings/SettingsViewModel';
import { TraceViewModel } from '../features/traces/TraceViewModel';
import { ArchitectureViewModel } from '../features/architecture/ArchitectureViewModel';
import { FlowchartViewModel } from '../features/flowchart/FlowchartViewModel';
import { PlansViewModel } from '../features/plans/PlansViewModel';
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
    constructor(
        readonly repo: RepositoryModel,
        readonly services: Services
    ) {
        this.shell = new ShellViewModel({ repo, services });
        this.settings = new SettingsViewModel({ repo, services });
        this.architecture = new ArchitectureViewModel({ repo, services });
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
            onSelect: (trace, workspace) => this.showTrace(trace, workspace),
            onClear: () => {
                this.flowchart.setTrace(null);
                this.architecture.setTrace(null);
                this.architecture.setQuery('');
                this.shell.showWorkspace('architecture');
                this.plans.close();
            },
            onReveal: (id) => this.architecture.inspect(id),
            onOpenPlan: (trace) => {
                void this.plans.open(trace);
            },
            onRequestFlow: (trace) => {
                this.traces.select(trace, 'flowchart');
                return this.flowchart.generate(this.traces.selected!);
            },
        });
    }
    private showTrace(trace: Trace, workspace: Workspace) {
        if (this.architecture.trace !== trace) this.architecture.setTrace(trace);
        if (this.flowchart.trace !== trace) this.flowchart.setTrace(trace);
        this.architecture.dismiss();
        this.shell.showWorkspace(workspace);
        this.shell.expandSidebar();
    }
    async init() {
        await Promise.all([this.settings.init(), this.traces.init()]);
    }
    dispose() {
        this.traces.dispose();
        this.plans.dispose();
        this.flowchart.dispose();
        this.architecture.dispose();
        this.settings.dispose();
        this.shell.dispose();
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

import { makeAutoObservable } from 'mobx';
import type { RepositoryModel } from '../../models/RepositoryModel';
import type { Workspace } from '../../models/types';
import type { ShellViewModel } from './ShellViewModel';
import type { TraceViewModel } from '../traces/TraceViewModel';
import type { ArchitectureViewModel } from '../architecture/ArchitectureViewModel';
import type { FlowchartViewModel } from '../flowchart/FlowchartViewModel';
import type { SitemapViewModel } from '../sitemap/SitemapViewModel';
import type { SettingsViewModel } from '../settings/SettingsViewModel';

export interface ViewSwitcherDeps {
    repo: RepositoryModel;
    shell: ShellViewModel;
    traces: TraceViewModel;
    architecture: ArchitectureViewModel;
    flowchart: FlowchartViewModel;
    sitemap: SitemapViewModel;
    settings: SettingsViewModel;
    /** Opens the trace composer (Flowchart on the map). */
    onNewTrace: () => void;
}
export interface ViewTab {
    id: Workspace;
    label: string;
    exists: boolean;
    busy: boolean;
}
export interface MissingAction {
    label: string;
    run: () => void;
    disabled?: boolean;
    title?: string;
}
export interface MissingState {
    title: string;
    hint?: string;
    error?: string;
    action: MissingAction;
}

const VIEWS: Workspace[] = ['architecture', 'flowchart', 'sitemap'];
const LABELS: Record<Workspace, string> = { architecture: 'Architecture', flowchart: 'Flowchart', sitemap: 'Sitemap' };
const NO_AI = 'Set up an AI tool in Settings first';

/** The one row of view tabs (map or trace), and what to show when the current view doesn't exist. */
export class ViewSwitcherViewModel {
    constructor(readonly deps: ViewSwitcherDeps) {
        makeAutoObservable(this, { deps: false }, { autoBind: true });
    }
    get trace() {
        return this.deps.traces.selected;
    }
    private exists(view: Workspace): boolean {
        const { repo, sitemap } = this.deps;
        // The repository sitemap uses the map-generation settings; the server reports a missing tool.
        const generateSitemap: MissingAction = { label: 'Generate', run: () => void sitemap.generate(), disabled: sitemap.loading };
        const trace = this.trace;
        if (!trace) {
            if (view === 'architecture') return repo.map.nodes.length > 0;
            if (view === 'sitemap') return !!sitemap.sitemap;
            return false;
        }
        if (view === 'architecture') return trace.steps.length > 0;
        if (view === 'flowchart') return !!trace.flow;
        return !!trace.sitemap;
    }
    private busy(view: Workspace): boolean {
        const { settings, flowchart, sitemap } = this.deps;
        if (view === 'architecture') return !this.trace && settings.busy;
        if (view === 'flowchart') return !!this.trace && flowchart.busy && flowchart.trace === this.trace;
        return sitemap.busy || (!this.trace && sitemap.loading);
    }
    get views(): ViewTab[] {
        return VIEWS.map((id) => ({ id, label: LABELS[id], exists: this.exists(id), busy: this.busy(id) }));
    }
    get current(): Workspace {
        return this.deps.shell.workspace;
    }
    /** The current view is missing and nothing is generating it: show the message instead. */
    get showMissing() {
        const view = this.views.find((v) => v.id === this.current)!;
        return !view.exists && !view.busy;
    }
    get context() {
        if (this.trace) return 'Trace · ' + this.trace.title;
        return this.deps.architecture.scope === 'workspace' ? 'Workspace map' : 'Map';
    }
    get missing(): MissingState {
        const { repo, shell, traces, flowchart, sitemap, settings } = this.deps;
        const view = this.current;
        const name = view === 'architecture' ? 'architecture' : view === 'flowchart' ? 'flowchart' : 'sitemap';
        const ai = repo.aiAvailable;
        const generate = (run: () => void, disabled = false): MissingAction => ({
            label: 'Generate',
            run,
            disabled: !ai || disabled,
            title: ai ? undefined : NO_AI,
        });
        // The repository sitemap uses the map-generation settings; the server reports a missing tool.
        const generateSitemap: MissingAction = { label: 'Generate', run: () => void sitemap.generate(), disabled: sitemap.loading };
        const trace = this.trace;
        if (!trace) {
            if (view === 'flowchart') {
                return { title: 'Flowcharts only exist for traces', action: { label: 'New trace', run: this.deps.onNewTrace } };
            }
            const title = `The ${name} view doesn't exist for this map`;
            if (view === 'architecture') {
                return {
                    title,
                    error: settings.jobError ? settings.jobStatus : undefined,
                    action: generate(() => {
                        shell.openSettings();
                        settings.redraw();
                    }, settings.jobsDisabled),
                };
            }
            return { title, error: sitemap.error ? sitemap.message : undefined, action: generateSitemap };
        }
        const title = `The ${name} view doesn't exist for this trace`;
        if (view === 'architecture') {
            return {
                title,
                hint: 'Generating it runs this trace again with Architecture selected.',
                action: generate(() => {
                    traces.editPrompt(trace);
                    traces.setOutput('architecture', true);
                }),
            };
        }
        if (view === 'flowchart') {
            return {
                title,
                error: flowchart.error && flowchart.trace === trace ? flowchart.status : undefined,
                action: generate(() => void flowchart.generate(trace)),
            };
        }
        if (!sitemap.sitemap) {
            return {
                title,
                hint: 'The repository sitemap is needed first.',
                error: sitemap.error ? sitemap.message : undefined,
                action: generateSitemap,
            };
        }
        return { title, error: sitemap.error ? sitemap.message : undefined, action: generate(() => void sitemap.generateTrace()) };
    }
    show(view: Workspace) {
        const { shell, traces } = this.deps;
        if (this.trace && this.exists(view)) void traces.openOutput(view);
        else if (this.trace) shell.showWorkspace(view);
        else shell.showRepository(view);
    }
}

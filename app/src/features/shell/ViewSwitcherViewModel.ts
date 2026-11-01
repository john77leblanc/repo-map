import { makeAutoObservable } from 'mobx';
import type { RepositoryModel } from '../../models/RepositoryModel';
import type { View } from '../../models/types';
import type { ShellViewModel } from './ShellViewModel';
import type { TraceViewModel } from '../traces/TraceViewModel';
import type { ArchitectureViewModel } from '../architecture/ArchitectureViewModel';
import type { FlowchartViewModel } from '../flowchart/FlowchartViewModel';
import type { SitemapViewModel } from '../sitemap/SitemapViewModel';
import type { ComponentsViewModel } from '../components/ComponentsViewModel';
import type { SettingsViewModel } from '../settings/SettingsViewModel';
import type { ProgressEntry } from '../../models/ProgressLog';

export interface ViewSwitcherDeps {
    repo: RepositoryModel;
    shell: ShellViewModel;
    traces: TraceViewModel;
    architecture: ArchitectureViewModel;
    flowchart: FlowchartViewModel;
    sitemap: SitemapViewModel;
    components: ComponentsViewModel;
    settings: SettingsViewModel;
    /** Opens the trace composer (Flowchart on the map). */
    onNewTrace: () => void;
}
export interface ViewTab {
    id: View;
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

/** A job drawing the current view: shown in the diagram area instead of the view. */
export interface GeneratingState {
    title: string;
    text: string;
    entries: ProgressEntry[];
    stop: () => void;
}

const VIEWS: View[] = ['architecture', 'flowchart', 'sitemap', 'components'];
const LABELS: Record<View, string> = { architecture: 'Architecture', flowchart: 'Flowchart', sitemap: 'Sitemap', components: 'Components' };
const NO_AI = 'Set up an AI tool in Settings first';

/** The one row of view tabs (map or trace), and what to show when the current view doesn't exist. */
export class ViewSwitcherViewModel {
    constructor(readonly deps: ViewSwitcherDeps) {
        makeAutoObservable(this, { deps: false }, { autoBind: true });
    }
    get trace() {
        return this.deps.traces.selected;
    }
    private exists(view: View): boolean {
        const { repo, sitemap, components } = this.deps;
        const trace = this.trace;
        if (!trace) {
            if (view === 'components') return !!components.components;
            if (view === 'architecture') return repo.map.nodes.length > 0;
            if (view === 'sitemap') return !!sitemap.sitemap;
            return false;
        }
        if (view === 'architecture') return trace.steps.length > 0;
        if (view === 'flowchart') return !!trace.flow;
        if (view === 'components') return !!trace.components;
        return !!trace.sitemap;
    }
    private busy(view: View): boolean {
        const { settings, flowchart, sitemap, components } = this.deps;
        if (view === 'components') return components.busy || (!this.trace && components.loading);
        if (view === 'architecture') return !this.trace && settings.busy;
        if (view === 'flowchart') return !!this.trace && flowchart.busy && flowchart.trace === this.trace;
        return sitemap.busy || (!this.trace && sitemap.loading);
    }
    get views(): ViewTab[] {
        return VIEWS.map((id) => ({ id, label: LABELS[id], exists: this.exists(id), busy: this.busy(id) }));
    }
    get current(): View {
        return this.deps.shell.workspace;
    }
    /** The current view is missing and nothing is generating it: show the message instead. */
    get showMissing() {
        const view = this.views.find((v) => v.id === this.current);
        return !!view && !view.exists && !view.busy;
    }
    /** The current view is being drawn (a repository redraw, or this trace's output): what to show meanwhile. */
    get generating(): GeneratingState | null {
        const { settings, flowchart, sitemap, components } = this.deps;
        const view = this.current;
        const trace = this.trace;
        if (view === 'architecture') {
            if (trace || !settings.busy || settings.jobKind !== 'generate') return null;
            return { title: settings.hasMap ? 'Redrawing the map…' : 'Drawing the map…', text: settings.jobStatus,
                entries: settings.jobLog.entries, stop: settings.stopJob };
        }
        if (view === 'flowchart') {
            // Closer looks report beside their box and keep the chart.
            if (!trace || !flowchart.busy || flowchart.trace !== trace || !flowchart.chartStatus) return null;
            return { title: trace.flow ? 'Redrawing the flowchart…' : 'Drawing the flowchart…', text: flowchart.chartStatus,
                entries: [], stop: () => flowchart.stop() };
        }
        if (view === 'sitemap') {
            if (!sitemap.busy) return null;
            const own = !!trace && !!sitemap.sitemap;
            return { title: own ? 'Drawing this trace’s sitemap…' : sitemap.sitemap ? 'Regenerating the sitemap…' : 'Generating the sitemap…',
                text: sitemap.message, entries: sitemap.log.entries, stop: sitemap.stop };
        }
        if (!components.busy) return null;
        const own = !!trace && !!components.components;
        return { title: own ? 'Drawing this trace’s components…' : components.components ? 'Regenerating the component map…' : 'Generating the component map…',
            text: components.message, entries: components.log.entries, stop: components.stop };
    }
    get context() {
        if (this.trace) return 'Trace · ' + this.trace.title;
        return this.deps.architecture.scope === 'workspace' ? 'Workspace map' : 'Map';
    }
    get missing(): MissingState {
        const { repo, shell, traces, flowchart, sitemap, components, settings } = this.deps;
        const view = this.current;
        const name = view;
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
            if (view === 'components') {
                return sitemap.sitemap?.screens.length
                    ? { title: "The components view doesn't exist for this map", hint: 'Components are mapped from the sitemap’s screens.',
                        error: components.error ? components.message : undefined,
                        action: { label: 'Generate', run: () => void components.generate(), disabled: components.loading } }
                    : { title: "The components view doesn't exist for this map", hint: 'Generate the sitemap first: components are mapped from its screens.',
                        error: sitemap.error ? sitemap.message : undefined, action: generateSitemap };
            }
            if (view === 'flowchart') {
                return { title: 'Flowcharts only exist for traces', action: { label: 'New trace', run: this.deps.onNewTrace } };
            }
            const title = `The ${name} view doesn't exist for this map`;
            if (view === 'architecture') {
                return {
                    title,
                    error: settings.jobError ? settings.jobStatus : undefined,
                    action: generate(() => {
                        shell.openSettings('map');
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
        if (view === 'components') {
            if (!components.components) {
                return sitemap.sitemap?.screens.length
                    ? { title, hint: 'The repository component map is needed first.', error: components.error ? components.message : undefined,
                        action: { label: 'Generate', run: () => void components.generate(), disabled: components.loading } }
                    : { title, hint: 'The repository component map is needed first, and it is mapped from the sitemap’s screens.',
                        error: sitemap.error ? sitemap.message : undefined, action: generateSitemap };
            }
            return { title, error: components.error ? components.message : undefined, action: generate(() => void components.generateTrace()) };
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
    show(view: View) {
        const { shell, traces } = this.deps;
        if (this.trace && this.exists(view)) void traces.openOutput(view);
        else if (this.trace) shell.showWorkspace(view);
        else shell.showRepository(view);
    }
}

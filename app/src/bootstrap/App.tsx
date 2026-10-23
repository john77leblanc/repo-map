import { createContext, useContext } from 'react';
import { observer } from 'mobx-react-lite';
import type { Application } from './Application';
import { ShellView } from '../features/shell/ShellView';
import { SettingsView } from '../features/settings/SettingsView';
import { ArchitectureWorkspace } from '../features/architecture/ArchitectureWorkspace';
import { FlowchartWorkspace, FlowchartDetails } from '../features/flowchart/FlowchartWorkspace';
import { TraceHome, SelectedTraceSidebar } from '../features/traces/TraceViews';
import { PlanModal } from '../features/plans/PlanModal';
import { CodeReference } from '../shared/ui/CodeReference';

export const ApplicationContext = createContext<Application | null>(null);
export function useApplication() {
    const app = useContext(ApplicationContext);
    if (!app) throw new Error('Application context is missing.');
    return app;
}
const RepositorySummary = observer(function RepositorySummary() {
    const { repo } = useApplication();
    const { config, repo: info } = repo.bootstrap!;
    const plural = (count: number, word: string) =>
        count === 1 || /s$/.test(word)
            ? word
            : /[^aeiou]y$/.test(word)
              ? word.slice(0, -1) + 'ies'
              : word + 's';
    const services = repo.map.nodes.filter((n) => n.kind === 'service').length;
    const topics = repo.map.nodes.filter((n) => n.kind === 'topic').length;
    return (
        <section className="repo-summary" aria-label="Repository">
            <h1 id="map-name">{config.name}</h1>
            <p className="sub">
                <code id="repo-name">{info.github || 'local repo'}</code>
                <span id="stat">
                    {services} {plural(services, config.kinds?.service || 'service')} · {topics}{' '}
                    {plural(topics, config.kinds?.topic || 'topic')} · {repo.map.edges.length}{' '}
                    {plural(repo.map.edges.length, 'connection')}
                </span>
                <span id="repoinfo">
                    reading {info.branch || 'detached HEAD'} @ {info.sha?.slice(0, 9)}
                    {info.dirty ? ' (uncommitted changes)' : ''}
                </span>
            </p>
        </section>
    );
});
export const App = observer(function App() {
    const app = useApplication();
    return (
        <>
            <ShellView
                vm={app.shell}
                selectedTrace={!!app.traces.selected}
                needsAttention={app.settings.notice}
                onBack={() => {
                    app.traces.clear();
                    document.getElementById('new-trace')?.focus();
                }}
                settings={
                    <SettingsView
                        vm={app.settings}
                        open={app.shell.settingsOpen}
                        onClose={app.shell.closeSettings}
                    />
                }
                sidebar={
                    <>
                        <TraceHome
                            vm={app.traces}
                            repositorySummary={<RepositorySummary />}
                            onRefreshAgents={() => {
                                void app.settings.loadCatalog(true);
                            }}
                        />
                        <SelectedTraceSidebar
                            vm={app.traces}
                            flowDetails={
                                <FlowchartDetails
                                    vm={app.flowchart}
                                    CodeReference={CodeReference}
                                />
                            }
                        />
                    </>
                }
                main={
                    app.shell.workspace === 'architecture' ? (
                        <ArchitectureWorkspace vm={app.architecture} />
                    ) : (
                        <FlowchartWorkspace
                            vm={app.flowchart}
                            CodeReference={CodeReference}
                            details={null}
                            onNewTrace={app.traces.toggleComposer}
                        />
                    )
                }
            />
            <PlanModal vm={app.plans} />
        </>
    );
});

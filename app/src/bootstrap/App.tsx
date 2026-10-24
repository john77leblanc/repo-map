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
import { SitemapWorkspace } from '../features/sitemap/SitemapWorkspace';
import { StartView } from '../features/start/StartView';

export const ApplicationContext = createContext<Application | null>(null);
export function useApplication() {
    const app = useContext(ApplicationContext);
    if (!app) throw new Error('Application context is missing.');
    return app;
}
export const App = observer(function App() {
    const app = useApplication();
    if (app.start.visible) return <StartView vm={app.start} />;
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
                    <>
                        {!app.traces.selected && (
                            <div className="repository-tabs" role="tablist" aria-label="Repository views">
                                {(['architecture', 'sitemap'] as const).map((workspace) => (
                                    <button
                                        key={workspace}
                                        className="btn"
                                        role="tab"
                                        id={'repository-tab-' + workspace}
                                        aria-controls={workspace + '-workspace'}
                                        aria-selected={app.shell.workspace === workspace}
                                        tabIndex={app.shell.workspace === workspace ? 0 : -1}
                                        onClick={() => app.shell.showRepository(workspace)}
                                        onKeyDown={(event) => {
                                            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                                            event.preventDefault();
                                            const next = event.key === 'Home' ? 'architecture'
                                                : event.key === 'End' ? 'sitemap'
                                                : workspace === 'architecture' ? 'sitemap' : 'architecture';
                                            app.shell.showRepository(next);
                                            document.getElementById('repository-tab-' + next)?.focus();
                                        }}
                                    >
                                        {workspace === 'architecture' ? 'Architecture' : 'Sitemap'}
                                    </button>
                                ))}
                            </div>
                        )}
                        {app.shell.workspace === 'sitemap' ? (
                            <SitemapWorkspace vm={app.sitemap} />
                        ) : app.shell.workspace === 'architecture' ? (
                            <ArchitectureWorkspace vm={app.architecture} />
                        ) : (
                            <FlowchartWorkspace
                                vm={app.flowchart}
                                CodeReference={CodeReference}
                                details={null}
                                onNewTrace={app.traces.toggleComposer}
                            />
                        )}
                    </>
                }
            />
            <PlanModal vm={app.plans} />
        </>
    );
});

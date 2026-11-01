import { createContext, useContext } from 'react';
import { observer } from 'mobx-react-lite';
import type { Application } from './Application';
import { ShellView } from '../features/shell/ShellView';
import { SettingsView } from '../features/settings/SettingsView';
import { ArchitectureWorkspace } from '../features/architecture/ArchitectureWorkspace';
import { FlowchartWorkspace } from '../features/flowchart/FlowchartWorkspace';
import { TraceHome, SelectedTraceSidebar } from '../features/traces/TraceViews';
import { PlanModal } from '../features/plans/PlanModal';
import { ComposerModal } from '../features/compose/ComposerModal';
import { ReferenceModal } from '../shared/ui/ReferenceModal';
import { CodeReference } from '../shared/ui/CodeReference';
import { SitemapWorkspace } from '../features/sitemap/SitemapWorkspace';
import { ComponentsWorkspace } from '../features/components/ComponentsWorkspace';
import { StartView } from '../features/start/StartView';
import { MissingView, ViewTabs } from '../features/shell/ViewTabs';
import { GeneratingView } from '../shared/ui/GeneratingView';
import { ScopeSwitch } from '../features/architecture/WorkspaceBar';

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
                        <TraceHome vm={app.traces} onNewTrace={app.composer.openNew} composerOpen={app.composer.open} />
                        <SelectedTraceSidebar vm={app.traces} />
                    </>
                }
                main={
                    <>
                        <ViewTabs vm={app.views}
                            leading={app.workspace.linked && (
                                <ScopeSwitch vm={app.architecture} disabled={app.shell.workspace !== 'architecture'} />
                            )} />
                        {app.views.generating ? (
                            <GeneratingView {...app.views.generating} onStop={app.views.generating.stop} />
                        ) : app.views.showMissing ? (
                            <MissingView vm={app.views} />
                        ) : app.shell.workspace === 'components' ? (
                            <ComponentsWorkspace vm={app.components} />
                        ) : app.shell.workspace === 'sitemap' ? (
                            <SitemapWorkspace vm={app.sitemap} />
                        ) : app.shell.workspace === 'architecture' ? (
                            <ArchitectureWorkspace vm={app.architecture} />
                        ) : (
                            <FlowchartWorkspace vm={app.flowchart} CodeReference={CodeReference} />
                        )}
                    </>
                }
            />
            <PlanModal vm={app.plans} />
            <ComposerModal vm={app.composer} onRefreshAgents={() => { void app.settings.loadCatalog(true); }} />
            <ReferenceModal vm={app.repo.references} />
        </>
    );
});

import { createRoot } from 'react-dom/client';
import { configure } from 'mobx';
import { createApplication } from './bootstrap/Application';
import { App, ApplicationContext } from './bootstrap/App';
import { createApiClient } from './shared/services/api';
import { createBrowserService, createStorage } from './shared/services/browser';
import { createDiagramExporter } from './shared/services/exporter';
import './shared/styles/base.css';

configure({ enforceActions: 'always' });
const root = createRoot(document.getElementById('root')!);
root.render(
    <p className="foot" role="status">
        Connecting to local server…
    </p>
);
let storage: Storage;
try {
    storage = window.localStorage;
} catch {
    storage = { getItem: () => null, setItem: () => {} } as unknown as Storage;
}
createApplication({
    api: createApiClient(),
    browser: createBrowserService(),
    exporter: createDiagramExporter(),
    storage: createStorage(storage),
})
    .then((app) => {
        root.render(
            <ApplicationContext.Provider value={app}>
                <App />
            </ApplicationContext.Provider>
        );
        window.addEventListener('pagehide', () => app.dispose(), { once: true });
        if (import.meta.hot)
            import.meta.hot.dispose(() => {
                app.dispose();
                root.unmount();
            });
    })
    .catch((error) =>
        root.render(
            <p className="foot" role="alert">
                Couldn’t load the map from the local server ({String(error.message || error)}).
                Start it with <code>repo-map serve</code> and reload.
            </p>
        )
    );

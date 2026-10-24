import { observer } from 'mobx-react-lite';
import { AgentPicker } from '../../shared/ui/AgentPicker';
import type { JobState, StartViewModel } from './StartViewModel';

const statusClass = (state: JobState) =>
    'status' + (state === 'running' ? ' busy' : state === 'error' ? ' err' : '');

function JobRow({ id, label, state, text, onStop, onRetry }: {
    id: string; label: string; state: JobState; text: string; onStop: () => void; onRetry: () => void;
}) {
    return (
        <div className="start-job" id={id}>
            <strong>{label}</strong>
            <span className={statusClass(state)} role="status" aria-live="polite">
                {text || (state === 'running' ? 'Starting…' : '')}
            </span>
            {state === 'running' && <button className="btn sm" type="button" onClick={onStop}>Stop</button>}
            {state === 'error' && <button className="btn sm" type="button" onClick={onRetry}>Retry</button>}
        </div>
    );
}

export const StartView = observer(function StartView({ vm }: { vm: StartViewModel }) {
    const settings = vm.deps.settings;
    const name = vm.deps.repo.bootstrap?.config.name || 'this repo';
    const showSitemapRow = vm.sitemapState !== 'idle' || (vm.includeSitemap && vm.running);
    return (
        <main className="start" id="start">
            <style>{START_CSS}</style>
            <div className="start-card">
                <h1>Build the map for {name}</h1>
                <p className="sub">
                    An AI tool reads your code (read-only) and draws the architecture map. This usually
                    takes a few minutes.
                </p>
                <label className="start-label" htmlFor="spick-agent">AI tool, model and effort</label>
                <AgentPicker
                    prefix="spick"
                    label="AI tool and model for the map"
                    agents={settings.data?.agents || []}
                    loading={settings.loading}
                    onRefresh={() => void settings.loadCatalog(true)}
                    value={settings.mapPick}
                    onChange={(pick) => void settings.setMapPick(pick)}
                    inheritLabel={'Same as traces' + (settings.data?.default ? ' · ' + settings.choiceLabel(settings.data.default) : '')}
                />
                <p className="hint">Saved for you in this repo. Change it later in Settings.</p>
                <label className="start-check">
                    <input
                        type="checkbox"
                        id="start-sitemap"
                        checked={vm.includeSitemap}
                        disabled={vm.running}
                        onChange={(e) => vm.setIncludeSitemap(e.target.checked)}
                    />
                    <span>
                        Also build the sitemap
                        <span className="hint"> · screens and navigation. Runs alongside the map as a second AI run, so it uses more of your plan or credits.</span>
                    </span>
                </label>
                <div className="start-actions">
                    <button className="btn primary" id="start-build" type="button" disabled={!vm.canBuild} onClick={() => void vm.build()}>
                        Build
                    </button>
                    {vm.hasMap && vm.running && (
                        <button className="btn" id="start-open" type="button" onClick={vm.openMap}>Open map</button>
                    )}
                </div>
                {vm.noAi && <p className="status err" role="status">{vm.noAi}</p>}
                {settings.catalogError && <p className="status err" role="status">{settings.catalogError}</p>}
                {vm.mapState !== 'idle' || vm.mapMessage ? (
                    <JobRow id="start-map-job" label="Map" state={vm.mapState} text={vm.mapMessage}
                        onStop={vm.stopMap} onRetry={vm.retryMap} />
                ) : null}
                {showSitemapRow && (
                    <JobRow id="start-sitemap-job" label="Sitemap" state={vm.sitemapState} text={vm.sitemapMessage}
                        onStop={vm.stopSitemap} onRetry={vm.retrySitemap} />
                )}
                <p className="start-alt">
                    <button className="start-link" id="start-folders" type="button" disabled={vm.running || vm.starting} onClick={() => void vm.useFolders()}>
                        Start from folders instead
                    </button>
                    <span className="hint"> · one card per code folder, no AI needed. You can redraw it later.</span>
                </p>
                {vm.folderError && <p className="status err" role="status">{vm.folderError}</p>}
            </div>
        </main>
    );
});

const START_CSS = `
.start{min-height:100vh;display:flex;align-items:flex-start;justify-content:center;padding:48px 16px}
.start-card{width:100%;max-width:560px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:24px;display:flex;flex-direction:column;gap:12px}
.start-card .hint{color:var(--muted);font-size:12.5px;margin:0}
.start-label{font-size:13px;font-weight:500;margin-top:8px}
.start-check{display:flex;gap:8px;align-items:flex-start;font-size:13.5px;cursor:pointer}
.start-check input{margin-top:3px}
.start-actions{display:flex;gap:8px;align-items:center}
.start-job{display:grid;grid-template-columns:72px minmax(0,1fr) auto;gap:8px;align-items:center;padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:var(--soft)}
.start-job .status{overflow-wrap:anywhere}
.start-alt{margin:8px 0 0;font-size:13px}
.start-link{font:inherit;background:none;border:0;padding:0;color:var(--http);cursor:pointer;text-decoration:underline}
.start-link:disabled{color:var(--muted);cursor:default}
.start-link:focus-visible{outline:2px solid var(--http);outline-offset:1px}
`;

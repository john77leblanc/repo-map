import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import type { ProgressLog } from '../../models/ProgressLog';
import { AgentPicker } from '../../shared/ui/AgentPicker';
import { ProgressLine } from '../../shared/ui/ProgressLine';
import { START_STEPS } from './StartViewModel';
import type { JobState, StartViewModel } from './StartViewModel';

const JobRow = observer(function JobRow({ id, label, state, log, onStop, onRetry }: {
    id: string; label: string; state: JobState; log: ProgressLog; onStop: () => void; onRetry: () => void;
}) {
    return (
        <div className="start-job" id={id}>
            <strong>{label}</strong>
            <ProgressLine text={log.last || (state === 'running' ? 'Starting…' : '')} entries={log.entries}
                busy={state === 'running'} error={state === 'error'} />
            {state === 'running' && <button className="btn sm" type="button" onClick={onStop}>Stop</button>}
            {state === 'error' && <button className="btn sm" type="button" onClick={onRetry}>Retry</button>}
        </div>
    );
});

const Steps = observer(function Steps({ vm }: { vm: StartViewModel }) {
    return (
        <ol className="start-steps" aria-label="Setup steps">
            {START_STEPS.map((s, i) => (
                <li key={s.id} className={i === vm.stepIndex ? 'on' : i < vm.stepIndex ? 'done' : ''}
                    aria-current={i === vm.stepIndex ? 'step' : undefined}>
                    <span className="n">{i + 1}</span>{s.label}
                </li>
            ))}
        </ol>
    );
});

const ProjectStep = observer(function ProjectStep({ vm }: { vm: StartViewModel }) {
    const suggested = new Set(vm.setup?.dirs.filter((d) => d.suggested).map((d) => d.path));
    return (
        <form className="start-form" onSubmit={(e) => { e.preventDefault(); void vm.saveProject(); }}>
            <h1>Set up repo-map</h1>
            <p className="sub">Tell the AI where your code lives. Saved to <code>.repo-map/config.json</code>, so your team shares it.</p>
            <label className="start-label" htmlFor="start-name">Map name</label>
            <input id="start-name" className="start-input" value={vm.name} maxLength={120}
                onChange={(e) => vm.setName(e.target.value)} disabled={vm.setupLoading} />
            <fieldset className="start-folders">
                <legend className="start-label">Code folders</legend>
                <p className="hint">Only these folders are read: by the AI, and by the code viewer.</p>
                {vm.setupLoading && <p className="hint">Looking at the repo…</p>}
                <div className="start-folder-list">
                    {vm.folderOptions.map((f) => (
                        <label key={f} className="start-chip">
                            <input type="checkbox" checked={vm.roots.includes(f)} onChange={(e) => vm.toggleRoot(f, e.target.checked)} />
                            <span>{f}</span>
                            {suggested.has(f) && <span className="hint"> · suggested</span>}
                        </label>
                    ))}
                </div>
                <div className="start-add">
                    <input className="start-input" aria-label="Add a folder" placeholder="Add a folder, e.g. packages/api"
                        value={vm.customFolder} onChange={(e) => vm.setCustomFolder(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); vm.addFolder(); } }} />
                    <button className="btn sm" type="button" onClick={vm.addFolder} disabled={!vm.customFolder.trim()}>Add</button>
                </div>
            </fieldset>
            <label className="start-label" htmlFor="start-context">What is this repo? <span className="hint">(optional, helps the AI)</span></label>
            <textarea id="start-context" className="start-input" rows={3} maxLength={1000} value={vm.context}
                placeholder="e.g. Next.js storefront; talks to a Go orders API and Stripe."
                onChange={(e) => vm.setContext(e.target.value)} />
            <div className="start-actions">
                <button className="btn primary" id="start-next" type="submit" disabled={!vm.canSaveProject}>
                    {vm.saving ? 'Saving…' : 'Next'}
                </button>
            </div>
        </form>
    );
});

const NoAiHelp = observer(function NoAiHelp({ vm }: { vm: StartViewModel }) {
    const settings = vm.deps.settings;
    return (
        <div className="start-help" id="start-no-ai">
            <p><strong>No AI tool found on this machine.</strong> The map still works: you can start from folders on the next step.</p>
            <p className="hint">To use AI, do one of these, then press Recheck:</p>
            <ul className="hint">
                <li>Install and sign in to Claude Code, Codex CLI or Gemini CLI.</li>
                <li>Run a local model with Ollama or LM Studio (free).
                    {vm.setup?.ollamaInstalled && <> Ollama is installed but not running: start it with <code>ollama serve</code>.</>}</li>
                <li>Use an API: set <code>REPO_MAP_API_KEY</code> in your shell, then restart repo-map. Keys are never saved to files.</li>
            </ul>
            <button className="btn sm" type="button" id="start-recheck" disabled={settings.loading}
                onClick={() => void settings.loadCatalog(true)}>{settings.loading ? 'Checking…' : 'Recheck'}</button>
        </div>
    );
});

const AiStep = observer(function AiStep({ vm }: { vm: StartViewModel }) {
    const settings = vm.deps.settings;
    const agents = settings.data?.agents || [];
    const ready = settings.available;
    return (
        <div className="start-form">
            <h1>Choose AI tools</h1>
            <p className="sub">The AI reads your code (read-only) to draw the map and answer traces.</p>
            {!settings.data && settings.loading && <p className="hint">Looking for AI tools…</p>}
            {settings.data && !ready && <NoAiHelp vm={vm} />}
            {ready && (
                <>
                    <label className="start-label" htmlFor="tpick-agent">Traces</label>
                    <AgentPicker prefix="tpick" label="AI tool and model for traces" agents={agents} loading={settings.loading}
                        onRefresh={() => void settings.loadCatalog(true)} value={settings.tracePick}
                        onChange={(pick) => pick && settings.setTracePick(pick)} />
                    <p className="hint">Your default in every repo. You can switch per trace.</p>
                    <label className="start-check">
                        <input type="checkbox" id="start-same" checked={vm.sameForMap} disabled={settings.saving}
                            onChange={(e) => vm.setSameForMap(e.target.checked)} />
                        <span>
                            Use the same for the map
                            <span className="hint"> · drawing the map reads the whole codebase once, so a stronger model or higher effort pays off there.</span>
                        </span>
                    </label>
                    {!vm.sameForMap && (
                        <>
                            <label className="start-label" htmlFor="spick-agent">Map</label>
                            <AgentPicker prefix="spick" label="AI tool and model for the map" agents={agents} loading={settings.loading}
                                onRefresh={() => void settings.loadCatalog(true)} value={settings.mapPick}
                                onChange={(pick) => void settings.setMapPick(pick)} />
                            <p className="hint">Saved for you in this repo.</p>
                        </>
                    )}
                </>
            )}
            {settings.catalogError && <p className="status err" role="status">{settings.catalogError}</p>}
            <div className="start-actions">
                <button className="btn" type="button" onClick={vm.back} disabled={!vm.canGoBack}>Back</button>
                {ready ? (
                    <>
                        <button className="btn primary" id="start-next" type="button" disabled={vm.saving || settings.saving}
                            onClick={() => void vm.saveAi()}>{vm.saving ? 'Saving…' : 'Next'}</button>
                        <button className="start-link" type="button" onClick={vm.skipAi}>Skip AI for now</button>
                    </>
                ) : (
                    <button className="btn primary" id="start-next" type="button" onClick={vm.skipAi}>Continue without AI</button>
                )}
            </div>
        </div>
    );
});

const BuildStep = observer(function BuildStep({ vm }: { vm: StartViewModel }) {
    const settings = vm.deps.settings;
    const name = vm.deps.repo.bootstrap?.config.name || 'this repo';
    const showSitemapRow = vm.sitemapState !== 'idle' || (vm.includeSitemap && vm.running);
    const mapTool = settings.choiceLabel(settings.mapPick) || settings.choiceLabel(settings.data?.generate) || '';
    return (
        <div className="start-form">
            <h1>Build the map for {name}</h1>
            <p className="sub">
                An AI tool reads your code (read-only) and draws the architecture map. This usually takes a few minutes.
            </p>
            {!vm.noAi && mapTool && <p className="hint" id="start-summary">Map: {mapTool}</p>}
            <label className="start-check">
                <input type="checkbox" id="start-sitemap" checked={vm.includeSitemap} disabled={vm.running || !!vm.noAi}
                    onChange={(e) => vm.setIncludeSitemap(e.target.checked)} />
                <span>
                    Also build the sitemap
                    <span className="hint"> · screens and navigation. Runs alongside the map as a second AI run, so it uses more of your plan or credits.</span>
                </span>
            </label>
            <div className="start-actions">
                <button className="btn" type="button" onClick={vm.back} disabled={!vm.canGoBack}>Back</button>
                <button className="btn primary" id="start-build" type="button" disabled={!vm.canBuild} onClick={() => void vm.build()}>
                    Build
                </button>
                {vm.hasMap && vm.running && (
                    <button className="btn" id="start-open" type="button" onClick={vm.openMap}>Open map</button>
                )}
            </div>
            {vm.noAi && <p className="status err" role="status">{vm.noAi}</p>}
            {vm.mapState !== 'idle' || vm.mapMessage ? (
                <JobRow id="start-map-job" label="Map" state={vm.mapState} log={vm.mapLog}
                    onStop={vm.stopMap} onRetry={vm.retryMap} />
            ) : null}
            {showSitemapRow && (
                <JobRow id="start-sitemap-job" label="Sitemap" state={vm.sitemapState} log={vm.sitemapLog}
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
    );
});

export const StartView = observer(function StartView({ vm }: { vm: StartViewModel }) {
    useEffect(() => { void vm.loadSetup(); }, [vm]);
    return (
        <main className="start" id="start">
            <style>{START_CSS}</style>
            <div className="start-card">
                <Steps vm={vm} />
                {vm.step === 'project' && <ProjectStep vm={vm} />}
                {vm.step === 'ai' && <AiStep vm={vm} />}
                {vm.step === 'build' && <BuildStep vm={vm} />}
                {vm.stepError && <p className="status err" role="status">{vm.stepError}</p>}
            </div>
        </main>
    );
});

const START_CSS = `
.start{min-height:100vh;display:flex;align-items:flex-start;justify-content:center;padding:48px 16px}
.start-card{width:100%;max-width:600px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:24px;display:flex;flex-direction:column;gap:12px}
.start-form{display:flex;flex-direction:column;gap:12px;margin:0}
.start-card .hint{color:var(--muted);font-size:12.5px;margin:0}
.start-card h1{margin:4px 0 0}
.start-card .sub{margin:0}
.start-steps{display:flex;gap:6px;list-style:none;margin:0;padding:0;font-size:12.5px;color:var(--muted);flex-wrap:wrap}
.start-steps li{display:flex;align-items:center;gap:6px}
.start-steps li+li::before{content:'';width:20px;height:1px;background:var(--line);margin-right:2px}
.start-steps .n{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;border:1px solid var(--line);font-size:11px}
.start-steps .on{color:inherit;font-weight:500}
.start-steps .on .n{background:var(--http);border-color:var(--http);color:#fff}
.start-steps .done .n{border-color:var(--http);color:var(--http)}
.start-label{font-size:13px;font-weight:500;margin-top:8px;padding:0}
.start-input{font:inherit;font-size:13.5px;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--soft);color:inherit;width:100%;box-sizing:border-box}
.start-input:focus-visible{outline:2px solid var(--http);outline-offset:1px}
textarea.start-input{resize:vertical}
.start-folders{border:0;margin:0;padding:0;display:flex;flex-direction:column;gap:8px;min-width:0}
.start-folder-list{display:flex;flex-wrap:wrap;gap:6px}
.start-chip{display:flex;align-items:center;gap:6px;font-size:13px;padding:4px 8px;border:1px solid var(--line);border-radius:6px;cursor:pointer;background:var(--soft)}
.start-add{display:flex;gap:8px;align-items:center}
.start-help{border:1px solid var(--line);border-radius:6px;padding:10px 12px;background:var(--soft);font-size:13.5px}
.start-help p{margin:0 0 6px}
.start-help ul{margin:0 0 8px;padding-left:18px}
.start-check{display:flex;gap:8px;align-items:flex-start;font-size:13.5px;cursor:pointer}
.start-check input{margin-top:3px}
.start-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:4px}
.start-job{display:grid;grid-template-columns:72px minmax(0,1fr) auto;gap:8px;align-items:start;padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:var(--soft)}
.start-job>strong{line-height:26px}.start-job .progress-line>summary,.start-job .progress-line>.progress-text{min-height:26px}
.start-alt{margin:8px 0 0;font-size:13px}
.start-link{font:inherit;font-size:13px;background:none;border:0;padding:0;color:var(--http);cursor:pointer;text-decoration:underline}
.start-link:disabled{color:var(--muted);cursor:default}
.start-link:focus-visible{outline:2px solid var(--http);outline-offset:1px}
`;

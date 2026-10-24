import { useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { DiagramSvg } from '../../shared/ui/DiagramSvg';
import { DiagramToolbar } from '../../shared/ui/DiagramToolbar';
import { DiagramMore } from '../../shared/ui/DiagramMore';
import { SitemapLegend } from './SitemapLegend';
import { SITEMAP_CSS } from './styles';
import { CodeReference } from '../../shared/ui/CodeReference';
import { FC_CSS, UI_CSS } from '../flowchart/styles';
import type { SitemapViewModel, SitemapScope, ConnectionTab } from './SitemapViewModel';
import { CHANGE_LABELS } from '../../../../lib/proposal.mjs';
import type { CodeRef } from '../../models/types';

/** Everything about one screen: shown inside its journey step, or below the journey otherwise. */
const ScreenDetails = observer(function ScreenDetails({ vm, id, stepRefs }: { vm: SitemapViewModel; id: string; stepRefs?: CodeRef[] }) {
    const screen = vm.screen(id);
    if (!screen) return null;
    const change = vm.changeFor(id);
    const original = vm.originalFor(id);
    return <div className="sitemap-screen-details">
        {screen.route && <p><code>{screen.route}</code></p>}
        <p>{screen.detail}</p>
        {change && <section aria-label="Proposed screen change">
            <h4>{CHANGE_LABELS[change.status]}</h4><p>{change.rationale}</p>
            {original && <details><summary>Original screen</summary><p>{original.label} — <code>{original.route}</code></p><p>{original.detail}</p></details>}
        </section>}
        {(!!stepRefs?.length || screen.refs.length > 0) && <div className="refs">
            {stepRefs?.map((reference, index) => <CodeReference key={`step:${index}`} reference={reference} repo={vm.repo} />)}
            {screen.refs.map((reference, index) => <CodeReference key={`${id}:${index}`} reference={reference} repo={vm.repo} />)}
        </div>}
        <ConnectionTabs vm={vm} id={id} />
    </div>;
});

const ConnectionTabs = observer(function ConnectionTabs({ vm, id }: { vm: SitemapViewModel; id: string }) {
    const nav = vm.navFor(id);
    if (!nav.from.length && !nav.to.length) return <p className="hint">No navigation found in code.</p>;
    const tabs: [ConnectionTab, string][] = [['from', 'From'], ['to', 'To']];
    const active = nav[vm.connectionTab].length ? vm.connectionTab : vm.connectionTab === 'to' ? 'from' : 'to';
    const panel = `sitemap-nav-${id}-${active}`;
    return <section className="sitemap-nav" aria-label="Navigation">
        <h4>Navigation</h4>
        <div className="sitemap-nav-tabs" role="tablist" aria-label="Navigation direction">
            {tabs.map(([tab, label]) => <button key={tab} type="button" role="tab" id={`sitemap-nav-${id}-${tab}-tab`}
                aria-selected={active === tab} aria-controls={panel} tabIndex={active === tab ? 0 : -1}
                disabled={!nav[tab].length} onClick={() => vm.setConnectionTab(tab)}
                onKeyDown={(e) => {
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
                    e.preventDefault();
                    const buttons = [...(e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)') || [])];
                    const index = buttons.indexOf(e.currentTarget);
                    const target = buttons[e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1
                        : (index + (e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length];
                    if (target) { target.focus(); target.click(); }
                }}>
                {label} ({nav[tab].length})
            </button>)}
        </div>
        <div role="tabpanel" id={panel} aria-labelledby={`sitemap-nav-${id}-${active}-tab`}>
            {nav[active].map((connection) => {
                const { edge, original } = connection;
                return <div className={'sitemap-connection' + (connection.journey ? '' : ' context')} key={connection.nav}>
                    <p><button className="btn sm" onClick={() => vm.select(connection.other)}
                        onMouseEnter={() => vm.hoverConnection(connection)} onMouseLeave={() => vm.hoverConnection(null)}
                        onFocus={() => vm.hoverConnection(connection)} onBlur={() => vm.hoverConnection(null)}>
                        {vm.screenLabel(connection.other)}
                    </button>{!connection.journey && <span className="hint"> · nearby</span>}</p>
                    {edge.label && <p>{edge.label}</p>}
                    {edge.condition && <p>When: {edge.condition}</p>}
                    {edge.status && <><p>{CHANGE_LABELS[edge.status]}: {edge.rationale}</p>
                        {original && <details><summary>Original navigation</summary>
                            <p>{original.from} → {original.to}: {original.label}</p><p>{original.condition}</p>
                        </details>}
                    </>}
                    {edge.refs.length > 0 && <div className="refs">{edge.refs.map((reference, i) => <CodeReference key={i} reference={reference} repo={vm.repo} />)}</div>}
                </div>;
            })}
        </div>
    </section>;
});

const SitemapWorkspace = observer(function SitemapWorkspace({ vm }: { vm: SitemapViewModel }) {
    const root = useRef<HTMLElement>(null);
    return (
        <section className="sitemap-workspace" id="sitemap-workspace" aria-label="Sitemap" ref={root}>
            <style>{FC_CSS + UI_CSS + SITEMAP_CSS}</style>
            <DiagramToolbar prefix="sitemap" label="Sitemap" available={!!vm.layout}
                selectors={<>
                    {vm.applications.length > 1 && (!vm.output || vm.wholeApplication) && <label>Application{' '}
                        <select aria-label="Application" value={vm.appId} onChange={event => vm.selectApp(event.target.value)}>
                            {vm.applications.map(app => <option key={app.id} value={app.id}>{app.label}</option>)}
                        </select>
                    </label>}
                    {vm.output?.applicability === 'relevant' && <label>Show{' '}
                        <select aria-label="Show" value={vm.scope} onChange={event => vm.setScope(event.target.value as SitemapScope)}>
                            <option value="trace">Trace screens</option>
                            <option value="nearby">Trace + nearby</option>
                            <option value="app">Whole application</option>
                        </select>
                    </label>}
                </>}
                diagramKey={{ id: 'sitemap-key', open: vm.keyOpen, toggle: vm.toggleKey }}
                status={vm.loading ? 'Loading sitemap...' : vm.message} busy={vm.busy} loading={vm.loading}
                error={vm.error} copied={vm.copied} onZoom={vm.zoom} onFit={() => {
                    const canvas = root.current?.querySelector('#sitemap-canvas');
                    if (canvas) vm.fit(canvas.clientWidth, canvas.clientHeight);
                }}
                onCopy={vm.copyMermaid} onDownload={vm.downloadSvg} onStop={vm.stop}
                extraActions={<DiagramMore id="sitemap-actions" open={vm.actionsOpen} setOpen={vm.setActionsOpen} actions={[
                    { label: vm.infoOpen || !vm.layout ? 'Hide info' : 'Show info', run: vm.toggleInfo,
                        disabled: !vm.layout, expanded: vm.infoOpen || !vm.layout, controls: 'sitemap-info' },
                    { label: vm.detailsOpen ? 'Hide details' : 'Show details', run: vm.toggleDetails,
                        disabled: !vm.layout, expanded: vm.detailsOpen && !!vm.layout, controls: 'sitemap-details' },
                    { label: 'Refresh status', run: () => void vm.load(), disabled: vm.loading || vm.busy },
                ]} />}
                generation={{
                    label: vm.trace && vm.sitemap ? vm.output ? 'Redraw' : vm.trace.pendingSitemap ? 'Retry' : 'Add output' : vm.sitemap ? 'Regenerate' : 'Generate sitemap',
                    title: vm.trace && vm.sitemap ? 'Ask the AI tool to draw this sitemap output again' : 'Analyze repository screens and navigation',
                    disabled: vm.loading || (!!vm.trace && !!vm.sitemap && !vm.repo.aiAvailable),
                    run: () => void (vm.trace && vm.sitemap ? vm.generateTrace() : vm.generate()),
                }}
            />
            <SitemapLegend open={vm.keyOpen} trace={!!vm.output} proposal={vm.trace?.intent === 'proposal'} />
            <div className="sitemap-heading" hidden={!vm.infoOpen && !!vm.layout}>
                <div id="sitemap-info" className="sitemap-info" hidden={!vm.infoOpen && !!vm.layout}>
                    <p className="hint">{vm.trace ? 'Repository sitemap: ' : ''}{vm.freshnessLabel}</p>
                    {vm.output && <p className="hint">This trace uses its saved sitemap snapshot{vm.output.base.commit ? ` at ${vm.output.base.commit.slice(0, 9)}` : ''}.
                        {vm.output.base.dirtyAtGeneration ? ' The snapshot included uncommitted changes.' : ''}
                        {vm.output.base.generatedAt !== vm.sitemap?.generatedAt ? ' The repository sitemap may have changed since this trace.' : ''}
                    </p>}
                    {(vm.freshness.dirty || vm.freshness.dirtyAtGeneration) && <p className="hint">
                        {vm.freshness.dirty ? 'The working tree has uncommitted code changes. ' : ''}
                        {vm.freshness.dirtyAtGeneration ? 'This sitemap was generated with uncommitted code changes. ' : ''}
                        Commit comparison cannot confirm an exact match.
                    </p>}
                    {vm.output ? <div className="sitemap-summary">
                        <p>{vm.output.applicability === 'none' ? 'No relevant screens. ' : ''}{vm.output.summary}</p>
                        {vm.output.gaps.length > 0 && <ul>{vm.output.gaps.map((gap, i) => <li key={i}>{gap}</li>)}</ul>}
                    </div> : vm.trace ? <p>{vm.sitemap ? 'Add a Sitemap output to follow this trace through screens and navigation.' : 'Generate the repository sitemap first, then add this trace’s Sitemap output.'}</p> : vm.sitemap ? <div className="sitemap-summary">
                        <p>{vm.sitemap.applicability === 'none' ? 'No user-facing screens found' : vm.sitemap.applicability === 'incomplete' ? 'Analysis incomplete' : `${vm.sitemap.screens.length} screens found`}</p>
                        <p>{vm.sitemap.summary}</p>
                        {vm.sitemap.gaps.length > 0 && <ul>{vm.sitemap.gaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul>}
                    </div> : !vm.loading && <p>Generate a sitemap to explore the whole application. Uses the map-generation AI settings in Settings.</p>}
                </div>
            </div>
            {vm.layout && <div className={'fmain sitemap-main' + (vm.detailsOpen ? '' : ' details-hidden')}>
                <DiagramSvg vm={vm} prefix="sitemap" />
                <aside className="fside" id="sitemap-details" aria-label="Screen details" aria-live="polite" hidden={!vm.detailsOpen}>
                    {!!vm.output?.steps.length && <section aria-label="Screen journey">
                        <h3>Journey</h3>
                        <ol className="sitemap-journey">
                            {vm.output.steps.map((step, index) => {
                                const open = vm.stepIndex === index;
                                return <li key={index}>
                                    <button className="sitemap-step" id={`sitemap-step-head-${index}`} aria-expanded={open}
                                        aria-controls={`sitemap-step-${index}`} onClick={() => vm.selectStep(index)}
                                        onMouseEnter={() => vm.hoverScreen(step.screen)} onMouseLeave={() => vm.hoverScreen(null)}
                                        onFocus={() => vm.hoverScreen(step.screen)} onBlur={() => vm.hoverScreen(null)}>
                                        Step {index + 1} · {vm.screenLabel(step.screen)}
                                    </button>
                                    {open && <div className="sitemap-step-panel" id={`sitemap-step-${index}`} role="region"
                                        aria-labelledby={`sitemap-step-head-${index}`}>
                                        <p>{step.note}</p>
                                        <ScreenDetails vm={vm} id={step.screen} stepRefs={step.refs} />
                                    </div>}
                                </li>;
                            })}
                        </ol>
                    </section>}
                    {vm.selected && !vm.output?.steps.some((step) => step.screen === vm.selectedId) ? <section aria-label="Selected screen">
                        <h3>{vm.screenLabel(vm.selected.id)}</h3>
                        <ScreenDetails vm={vm} id={vm.selected.id} />
                    </section> : !vm.selected && <p>Select a screen for its routes, navigation conditions, and code references. Arrows show navigation found in code.</p>}
                </aside>
            </div>}
        </section>
    );
});

export { SitemapWorkspace };

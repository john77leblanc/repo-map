import { useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { DiagramSvg } from '../../shared/ui/DiagramSvg';
import { DiagramToolbar } from '../../shared/ui/DiagramToolbar';
import { DiagramMore } from '../../shared/ui/DiagramMore';
import { SitemapLegend } from './SitemapLegend';
import { SITEMAP_CSS } from './styles';
import { CodeReference } from '../../shared/ui/CodeReference';
import { DirectionTabs, type DirectionTab } from '../../shared/ui/DirectionTabs';
import { Disclosure, DisclosureList } from '../../shared/ui/Disclosure';
import { SidePanel } from '../../shared/ui/SidePanel';
import { FC_CSS, UI_CSS } from '../flowchart/styles';
import type { SitemapViewModel, SitemapScope, ConnectionTab, Connection } from './SitemapViewModel';
import { CHANGE_LABELS } from '../../../../lib/proposal.mjs';
import { TraceStepCard } from '../../shared/ui/TraceStepCard';
import { ConnectionRow } from '../flowchart/ConnectionRow';

/** The selected screen's panel: trace step, then About, Navigation and References, like the flowchart's. */
const ScreenPanel = observer(function ScreenPanel({ vm }: { vm: SitemapViewModel }) {
    const screen = vm.selected;
    if (!screen) return null;
    const id = screen.id;
    const change = vm.changeFor(id);
    const original = vm.originalFor(id);
    const nav = vm.navFor(id);
    const all = [...nav.from, ...nav.to];
    const changedNav = all.filter((c) => c.edge.status);
    const navRefs = all.filter((c) => c.edge.refs.length);
    const refCount = screen.refs.length + navRefs.reduce((n, c) => n + c.edge.refs.length, 0);
    const step = vm.currentStep >= 0 ? vm.output?.steps[vm.currentStep] : undefined;
    const navLabel = (c: Connection) => `${vm.screenLabel(c.edge.from)} → ${vm.screenLabel(c.edge.to)}`;
    return (
        <SidePanel id="sitemap-details" aria-label="Screen details" aria-live="polite" closeId="sitemap-details-close"
            onClose={vm.closeDetails} title={vm.screenLabel(id)} status={change?.status} kind="Screen">
            {step && (
                <TraceStepCard idPrefix="sitemap" index={vm.currentStep} total={vm.output!.steps.length} note={step.note}
                    hasPrev={vm.hasPrev} hasNext={vm.hasNext} onPrev={vm.prevStep} onNext={vm.nextStep}>
                    {step.refs.map((r, i) => <CodeReference key={i} reference={r} repo={vm.repo} list={step.refs} index={i} />)}
                </TraceStepCard>
            )}
            <DisclosureList>
                <Disclosure id="sitemap-about" title="About" open={vm.sections.about} onToggle={(open) => vm.setSection('about', open)}>
                    {screen.route && <p><code>{screen.route}</code></p>}
                    {screen.detail && <p className="fd">{screen.detail}</p>}
                    {change && (
                        <section className="flow-change" aria-label="Proposed screen change">
                            <h4 className={change.status}>{CHANGE_LABELS[change.status]}</h4>
                            {change.rationale && <p>{change.rationale}</p>}
                            {original && <p className="hint">Was: {original.label}{original.route && <> — <code>{original.route}</code></>}{original.detail ? '. ' + original.detail : ''}</p>}
                        </section>
                    )}
                    {changedNav.length > 0 && (
                        <section className="flow-change sitemap-nav-changes" aria-label="Proposed navigation">
                            <h4>Proposed navigation</h4>
                            {changedNav.map((c) => (
                                <p key={c.nav}>
                                    <span className={'proposal-badge ' + c.edge.status}>{CHANGE_LABELS[c.edge.status!]}</span>{' '}
                                    <b>{navLabel(c)}</b>{c.edge.rationale ? ': ' + c.edge.rationale : ''}
                                    {c.original && <span className="hint"> Was: {c.original.label || 'link'}{c.original.condition ? ' when ' + c.original.condition : ''}.</span>}
                                </p>
                            ))}
                        </section>
                    )}
                </Disclosure>
                <Disclosure id="sitemap-nav" title="Navigation" count={all.length} open={vm.sections.nav} onToggle={(open) => vm.setSection('nav', open)}>
                    <ScreenNavigation vm={vm} id={id} />
                </Disclosure>
                {refCount > 0 && (
                    <Disclosure id="sitemap-refs" title="References" count={refCount} open={vm.sections.refs} onToggle={(open) => vm.setSection('refs', open)}>
                        {screen.refs.length > 0 && <div className="refs">
                            {screen.refs.map((r, i) => <CodeReference key={i} reference={r} repo={vm.repo} list={screen.refs} index={i} />)}
                        </div>}
                        {navRefs.length > 0 && <section className="sitemap-nav-refs" aria-label="Navigation code">
                            <h4>Navigation</h4>
                            {navRefs.map((c) => (
                                <div key={c.nav}>
                                    <p className="hint">{navLabel(c)}</p>
                                    <div className="refs">
                                        {c.edge.refs.map((r, i) => <CodeReference key={i} reference={r} repo={vm.repo} list={c.edge.refs} index={i} />)}
                                    </div>
                                </div>
                            ))}
                        </section>}
                    </Disclosure>
                )}
            </DisclosureList>
        </SidePanel>
    );
});

/** Links arriving at (From) and leaving (To) the screen, as flowchart-style connection rows. */
const ScreenNavigation = observer(function ScreenNavigation({ vm, id }: { vm: SitemapViewModel; id: string }) {
    const nav = vm.navFor(id);
    if (!nav.from.length && !nav.to.length) return <p className="hint">No navigation found in code.</p>;
    const tabs: DirectionTab<ConnectionTab>[] = [{ id: 'from', label: 'From', count: nav.from.length }, { id: 'to', label: 'To', count: nav.to.length }];
    return (
        <section className="flow-conn sitemap-nav" aria-label="Navigation">
            <DirectionTabs idPrefix={'sitemap-nav-' + id} label="Navigation direction" tabs={tabs} active={vm.connectionTab} onChange={vm.setConnectionTab}>
                {(active) => (
                    <ul>
                        {nav[active].map((c) => (
                            <li key={c.nav}>
                                <ConnectionRow go={c.other} title={vm.screenLabel(c.other)} shape={{ type: 'process' }}
                                    status={vm.changeFor(c.other)?.status} arrow={{ label: c.edge.label, status: c.edge.status }}
                                    note={c.edge.condition && 'When: ' + c.edge.condition} context={!c.journey} direction={active}
                                    onClick={() => { vm.hoverConnection(null); vm.select(c.other); }}
                                    onHover={(on) => vm.hoverConnection(on ? c : null)} />
                            </li>
                        ))}
                    </ul>
                )}
            </DirectionTabs>
        </section>
    );
});

const SitemapWorkspace = observer(function SitemapWorkspace({ vm }: { vm: SitemapViewModel }) {
    const root = useRef<HTMLElement>(null);
    // Closed until a screen is picked, like the flowchart's step panel.
    const panelOpen = vm.detailsOpen && !!vm.selected;
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
                status={vm.loading ? 'Loading sitemap...' : vm.message} log={vm.log.entries} busy={vm.busy} loading={vm.loading}
                error={vm.error} copied={vm.copied} onZoom={vm.zoom} onFit={() => {
                    const canvas = root.current?.querySelector('#sitemap-canvas');
                    if (canvas) vm.fit(canvas.clientWidth, canvas.clientHeight);
                }}
                onCopy={vm.copyMermaid} onDownload={vm.downloadSvg} onStop={vm.stop}
                extraActions={<DiagramMore id="sitemap-actions" open={vm.actionsOpen} setOpen={vm.setActionsOpen} actions={[
                    { label: vm.infoOpen || !vm.layout ? 'Hide info' : 'Show info', run: vm.toggleInfo,
                        disabled: !vm.layout, expanded: vm.infoOpen || !vm.layout, controls: 'sitemap-info' },
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
            {vm.layout && <div className={'fmain sitemap-main' + (panelOpen ? '' : ' details-hidden')}>
                <DiagramSvg vm={vm} prefix="sitemap" />
                {panelOpen && <ScreenPanel vm={vm} />}
            </div>}
        </section>
    );
});

export { SitemapWorkspace };

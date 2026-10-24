import { useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { DiagramSvg } from '../../shared/ui/DiagramSvg';
import { DiagramToolbar } from '../../shared/ui/DiagramToolbar';
import { DiagramMore } from '../../shared/ui/DiagramMore';
import { SitemapLegend } from './SitemapLegend';
import { SITEMAP_CSS } from './styles';
import { CodeReference } from '../../shared/ui/CodeReference';
import { FC_CSS, UI_CSS } from '../flowchart/styles';
import type { SitemapViewModel } from './SitemapViewModel';
import { CHANGE_LABELS } from '../../../../lib/proposal.mjs';
import type { SitemapNavigation, ChangeStatus } from '../../models/types';

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
                    {vm.output?.applicability === 'relevant' && <label>
                        <input type="checkbox" checked={vm.wholeApplication} onChange={vm.toggleContext} /> Whole application
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
                            {vm.output.steps.map((step, index) => <li key={index}>
                                <button className="btn" aria-pressed={vm.stepIndex === index} onClick={() => vm.selectStep(index)}>
                                    {vm.screenLabel(step.screen)}
                                </button>
                                {vm.stepIndex === index && <p>{step.note}</p>}
                            </li>)}
                        </ol>
                    </section>}
                    {vm.selected ? <>
                        <h3>{vm.screenLabel(vm.selected.id)}</h3>
                        {vm.selected.route && <p><code>{vm.selected.route}</code></p>}
                        <p>{vm.selected.detail}</p>
                        {vm.selectedStep && <section aria-label="Journey step details">
                            <h4>Step {vm.stepIndex! + 1}</h4>
                            <div className="refs">{vm.selectedStep.refs.map((reference, index) => <CodeReference key={index} reference={reference} repo={vm.repo} />)}</div>
                        </section>}
                        {vm.selectedChange && <section aria-label="Proposed screen change">
                            <h4>{CHANGE_LABELS[vm.selectedChange.status]}</h4><p>{vm.selectedChange.rationale}</p>
                            {vm.original && <details><summary>Original screen</summary><p>{vm.original.label} — <code>{vm.original.route}</code></p><p>{vm.original.detail}</p></details>}
                        </section>}
                        <div className="refs">{vm.selected.refs.map((reference, index) => <CodeReference key={`${vm.selectedId}:${index}`} reference={reference} repo={vm.repo} />)}</div>
                        {vm.connections.length > 0 && <h4>Navigation</h4>}
                        {vm.connections.map((edge, index) => {
                            const change = edge as SitemapNavigation & { status?: ChangeStatus; rationale?: string; index?: number };
                            const original = change.index === undefined ? null : vm.output?.base.navigation[change.index];
                            const outgoing = edge.from === vm.selectedId;
                            const other = outgoing ? edge.to : edge.from;
                            return <div className="sitemap-connection" key={`${vm.selectedId}:${index}`}>
                                <p>{outgoing ? 'To ' : 'From '}<button className="btn sm" onClick={() => vm.select(other)}>{vm.screenLabel(other)}</button></p>
                                {edge.label && <p>{edge.label}</p>}
                                {edge.condition && <p>When: {edge.condition}</p>}
                                {change.status && <><p>{CHANGE_LABELS[change.status]}: {change.rationale}</p>
                                    {original && <details><summary>Original navigation</summary>
                                        <p>{original.from} → {original.to}: {original.label}</p><p>{original.condition}</p>
                                    </details>}
                                </>}
                                <div className="refs">{edge.refs.map((reference, i) => <CodeReference key={i} reference={reference} repo={vm.repo} />)}</div>
                            </div>;
                        })}
                    </> : <p>Select a screen for its routes, navigation conditions, and code references. Arrows show navigation found in code.</p>}
                </aside>
            </div>}
        </section>
    );
});

export { SitemapWorkspace };

import { useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { DiagramSvg } from '../../shared/ui/DiagramSvg';
import { DiagramToolbar } from '../../shared/ui/DiagramToolbar';
import { DiagramMore } from '../../shared/ui/DiagramMore';
import { FC_CSS, UI_CSS } from '../flowchart/styles';
import { ComponentPanel } from './ComponentPanel';
import { ROOTS, TRACE } from './ComponentGraphViewModel';
import type { ComponentsViewModel } from './ComponentsViewModel';
import { hasChanges } from '../../models/trace';
import { SidePanel } from '../../shared/ui/SidePanel';
import { SearchPanel, SearchToggle } from '../../shared/ui/SearchPanel';
import { useSearchShortcut } from '../../shared/ui/useSearchShortcut';

/** Diagram key: components and what renders what; in a trace, what its changes look like. */
function ComponentsLegend({ open, proposal = false, review = false }: { open: boolean; proposal?: boolean; review?: boolean }) {
    return (
        <section className="flegend" id="components-key" aria-label="Diagram key" hidden={!open}>
            <div>
                <span><svg viewBox="0 0 22 14" aria-hidden="true"><rect className="lg" x="1" y="2" width="20" height="10" rx="2" /></svg>component</span>
                <span><svg viewBox="0 0 22 14" aria-hidden="true"><path className="lg sitemap-key-arrow" d="M1 7H20M15 3L20 7L15 11" /></svg>renders</span>
                <span>Top row: components nothing else renders (usually pages).</span>
            </div>
            <p data-proposal-key className="proposal-legend" hidden={!proposal}>
                {review ? 'Changes in this review:' : 'Proposed changes:'} <span className="key-change">New</span>{' '}
                <span className="key-change modified">Modified</span>{' '}
                <span className="key-change removed">Removed</span>{review ? '.' : '. Proposed changes are not implemented code.'}
            </p>
        </section>
    );
}

/** The Components view: the repository component map as a diagram, with a panel for the picked component. */
const ComponentsWorkspace = observer(function ComponentsWorkspace({ vm }: { vm: ComponentsViewModel }) {
    const root = useRef<HTMLElement>(null);
    const graph = vm.graph;
    const panelOpen = graph.sideOpen;
    const componentOpen = graph.detailsOpen && !!graph.selected;
    useSearchShortcut({ inputId: 'components-q', open: graph.openSearch, escape: graph.escape });
    const map = vm.components;
    const output = vm.output;
    const trace = vm.trace;
    const shown = vm.displayed;
    return (
        <section className="sitemap-workspace" id="components-workspace" aria-label="Components" ref={root}>
            <style>{FC_CSS + UI_CSS}</style>
            <DiagramToolbar prefix="components" label="Components" available={!!graph.layout}
                selectors={shown && (graph.screens.length > 0 || !!output) && <label>Show{' '}
                    <select aria-label="Show" value={graph.scope} onChange={(event) => graph.setScope(event.target.value)}>
                        {output && <option value={TRACE}>{trace?.intent === 'review' ? 'This review' : 'This trace'}</option>}
                        <option value={ROOTS}>All roots</option>
                        {graph.screens.map((screen) => <option key={screen.id} value={screen.id}>{screen.label}</option>)}
                    </select>
                </label>}
                diagramKey={{ id: 'components-key', open: vm.keyOpen, toggle: vm.toggleKey }}
                status={vm.loading ? 'Loading components...' : vm.message} log={vm.log.entries} busy={vm.busy} loading={vm.loading}
                error={vm.error} copied={vm.copied} onZoom={graph.zoom} onFit={() => {
                    const canvas = root.current?.querySelector('#components-canvas');
                    if (canvas) graph.fit(canvas.clientWidth, canvas.clientHeight);
                }}
                onCopy={vm.copyMermaid} onDownload={vm.downloadSvg} onStop={vm.stop}
                extraActions={<DiagramMore id="components-actions" open={vm.actionsOpen} setOpen={vm.setActionsOpen} actions={[
                    { label: vm.infoOpen || !graph.layout ? 'Hide info' : 'Show info', run: vm.toggleInfo,
                        disabled: !graph.layout, expanded: vm.infoOpen || !graph.layout, controls: 'components-info' },
                    { label: 'Refresh status', run: () => void vm.load(), disabled: vm.loading || vm.busy },
                ]} />}
                search={graph.layout && <SearchToggle id="components-search-toggle" controls="component-details" open={graph.search.open} onToggle={graph.toggleSearch} />}
            />
            <ComponentsLegend open={vm.keyOpen} proposal={!!output && hasChanges(trace)} review={trace?.intent === 'review'} />
            <div className="sitemap-heading" hidden={!vm.infoOpen && !!graph.layout}>
                <div id="components-info" className="sitemap-info" hidden={!vm.infoOpen && !!graph.layout}>
                    <p className="hint">{trace ? 'Repository component map: ' : ''}{vm.freshnessLabel}</p>
                    {output && <p className="hint">This trace uses its saved component map snapshot.
                        {output.base.summary !== map?.summary ? ' The repository component map may have changed since this trace.' : ''}</p>}
                    {output ? <div className="sitemap-summary">
                        <p>{output.summary}</p>
                        {output.gaps.length > 0 && <ul>{output.gaps.map((gap, i) => <li key={i}>{gap}</li>)}</ul>}
                    </div> : trace ? <p>{map ? 'Add a Components output to see which UI components this trace uses.'
                        : 'Generate the repository component map first, then add this trace’s Components output.'}</p> : map ? <div className="sitemap-summary">
                        <p>{vm.label}</p>
                        <p>{map.summary}</p>
                        {map.gaps.length > 0 && <ul>{map.gaps.map((gap, i) => <li key={i}>{gap}</li>)}</ul>}
                    </div> : !vm.loading && <p>{vm.canGenerate
                        ? 'Generate components to see which UI components build each screen. Uses the map-generation AI settings in Settings.'
                        : 'Generate the sitemap first: components are mapped from its screens.'}</p>}
                </div>
            </div>
            {graph.layout && <div className={'fmain sitemap-main' + (panelOpen ? '' : ' details-hidden')}>
                <DiagramSvg vm={graph} prefix="components" />
                {panelOpen && (componentOpen ? <ComponentPanel vm={vm} /> : (
                    <SidePanel id="component-details" className="search-side" closeId="component-details-close" title="Search"
                        closeOnEscape={false} onClose={graph.dismiss}>
                        <SearchPanel search={graph.search} prefix="components" label="Find a component" listLabel="Matching components"
                            empty="No components match." onPick={graph.select} onHover={graph.hoverHit} />
                    </SidePanel>
                ))}
            </div>}
        </section>
    );
});

export { ComponentsWorkspace };

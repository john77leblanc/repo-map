import { observer } from 'mobx-react-lite';
import { CodeReference } from '../../shared/ui/CodeReference';
import { Disclosure, DisclosureList } from '../../shared/ui/Disclosure';
import { SidePanel } from '../../shared/ui/SidePanel';
import { Tabs, type TabItem } from '../../shared/ui/Tabs';
import { ConnectionRow } from '../flowchart/ConnectionRow';
import { TraceStepCard } from '../../shared/ui/TraceStepCard';
import { CHANGE_LABELS } from '../../../../lib/proposal.mjs';
import type { ComponentTab } from './ComponentGraphViewModel';
import type { ComponentsViewModel } from './ComponentsViewModel';

/**
 * The selected component on the Components diagram: in a trace, its step and change first;
 * then About, Used in, Connections and References.
 */
const ComponentPanel = observer(function ComponentPanel({ vm }: { vm: ComponentsViewModel }) {
    const graph = vm.graph;
    const component = graph.selected;
    if (!component) return null;
    const id = component.id;
    const renders = graph.links.renders.get(id) || [];
    const renderedBy = graph.links.renderedBy.get(id) || [];
    const screens = graph.usage.get(id) || [];
    const output = graph.output;
    const step = graph.stepIndex >= 0 ? output?.involved[graph.stepIndex] : undefined;
    const change = graph.changeFor(id);
    const original = change?.status === 'modified' ? graph.originalFor(id) : undefined;
    const changedUses = graph.changedUses(id);
    const review = vm.trace?.intent === 'review';
    const tabs: TabItem<ComponentTab>[] = [
        { id: 'from', label: 'Rendered by', count: renderedBy.length },
        { id: 'to', label: 'Renders', count: renders.length },
    ];
    return (
        <SidePanel id="component-details" aria-label="Component details" aria-live="polite" closeId="component-details-close"
            onClose={graph.closeDetails} title={component.label} status={change?.status} kind="Component">
            {step && (
                <TraceStepCard idPrefix="components" index={graph.stepIndex} total={output!.involved.length} note={step.note}
                    hasPrev={graph.hasPrev} hasNext={graph.hasNext} onPrev={graph.prevStep} onNext={graph.nextStep}>
                    {step.refs.map((r, i) => <CodeReference key={i} reference={r} repo={vm.repo} list={step.refs} index={i} />)}
                </TraceStepCard>
            )}
            <DisclosureList>
                <Disclosure id="component-about" title="About" open={graph.sections.about} onToggle={(open) => graph.setSection('about', open)}>
                    {component.detail ? <p className="fd">{component.detail}</p> : <p className="hint">No description.</p>}
                    {component.tags.length > 0 && <p>{component.tags.map((tag) => <span key={tag} className="component-tag">{tag}</span>)}</p>}
                    {component.card && <p className="hint">Architecture card: <code>{component.card}</code></p>}
                    {change && (
                        <section className="flow-change" aria-label={review ? 'Component change' : 'Proposed component change'}>
                            <h4 className={change.status}>{CHANGE_LABELS[change.status]}</h4>
                            {change.rationale && <p>{change.rationale}</p>}
                            {original && <p className="hint">Was: {original.label}{original.detail ? '. ' + original.detail : ''}</p>}
                        </section>
                    )}
                    {changedUses.length > 0 && (
                        <section className="flow-change" aria-label={review ? 'Changed render links' : 'Proposed render links'}>
                            <h4>{review ? 'Changed render links' : 'Proposed render links'}</h4>
                            {changedUses.map((u) => (
                                <p key={u.from + '>' + u.to}>
                                    <span className={'proposal-badge ' + u.status}>{CHANGE_LABELS[u.status]}</span>{' '}
                                    <b>{graph.label(u.from)} renders {graph.label(u.to)}</b>{u.rationale ? ': ' + u.rationale : ''}
                                </p>
                            ))}
                        </section>
                    )}
                </Disclosure>
                <Disclosure id="component-used-in" title="Used in" count={screens.length} open={graph.sections.usedIn}
                    onToggle={(open) => graph.setSection('usedIn', open)}>
                    {screens.length ? <section className="flow-conn" aria-label="Screens using this component">
                        <ul>
                            {screens.map((screen) => {
                                const route = graph.screenRoute(screen);
                                return (
                                    <li key={screen}>
                                        <ConnectionRow go={screen} title={graph.screenLabel(screen)} shape={{ type: 'start' }}
                                            note={route ? <code>{route}</code> : undefined}
                                            onClick={() => vm.openScreen(screen)} onHover={() => {}} />
                                    </li>
                                );
                            })}
                        </ul>
                    </section> : <p className="hint">Not on any screen.</p>}
                </Disclosure>
                <Disclosure id="component-connections" title="Connections" count={renders.length + renderedBy.length}
                    open={graph.sections.connections} onToggle={(open) => graph.setSection('connections', open)}>
                    {renders.length + renderedBy.length === 0 ? <p className="hint">Renders no other mapped component.</p> : (
                        <section className="flow-conn" aria-label="Connections">
                            <Tabs idPrefix={'component-conn-' + id} label="Connection direction" tabs={tabs} active={graph.connectionTab}
                                onChange={graph.setConnectionTab}>
                                {(active) => (
                                    <ul>
                                        {(active === 'from' ? renderedBy : renders).map((other) => (
                                            <li key={other}>
                                                <ConnectionRow go={other} title={graph.label(other)} shape={{ type: 'process' }} direction={active}
                                                    onClick={() => { graph.hover(null); graph.select(other); }}
                                                    onHover={(on) => graph.hover(on ? [id, other] : null)} />
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </Tabs>
                        </section>
                    )}
                </Disclosure>
                {component.refs.length > 0 && (
                    <Disclosure id="component-refs" title="References" count={component.refs.length} open={graph.sections.refs}
                        onToggle={(open) => graph.setSection('refs', open)}>
                        <div className="refs">
                            {component.refs.map((r, i) => <CodeReference key={i} reference={r} repo={vm.repo} list={component.refs} index={i} />)}
                        </div>
                    </Disclosure>
                )}
            </DisclosureList>
        </SidePanel>
    );
});

export { ComponentPanel };

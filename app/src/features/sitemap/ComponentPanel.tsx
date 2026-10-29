import { observer } from 'mobx-react-lite';
import { CodeReference } from '../../shared/ui/CodeReference';
import { Disclosure, DisclosureList } from '../../shared/ui/Disclosure';
import { SidePanel } from '../../shared/ui/SidePanel';
import { Tabs, type TabItem } from '../../shared/ui/Tabs';
import { ConnectionRow } from '../flowchart/ConnectionRow';
import type { ComponentTab } from './ComponentGraphViewModel';
import type { SitemapViewModel } from './SitemapViewModel';

/** The selected component on the Components diagram: About, Screens, Connections and References. */
const ComponentPanel = observer(function ComponentPanel({ vm }: { vm: SitemapViewModel }) {
    const graph = vm.componentGraph;
    const component = graph.selected;
    if (!component) return null;
    const id = component.id;
    const screens = graph.usage.get(id) || [];
    const renders = graph.links.renders.get(id) || [];
    const renderedBy = graph.links.renderedBy.get(id) || [];
    const tabs: TabItem<ComponentTab>[] = [
        { id: 'from', label: 'Rendered by', count: renderedBy.length },
        { id: 'to', label: 'Renders', count: renders.length },
    ];
    return (
        <SidePanel id="component-details" aria-label="Component details" aria-live="polite" closeId="component-details-close"
            onClose={graph.closeDetails} title={component.label} kind="Component">
            <DisclosureList>
                <Disclosure id="component-about" title="About" open={graph.sections.about} onToggle={(open) => graph.setSection('about', open)}>
                    {component.detail ? <p className="fd">{component.detail}</p> : <p className="hint">No description.</p>}
                    {component.tags.length > 0 && <p>{component.tags.map((tag) => <span key={tag} className="component-tag">{tag}</span>)}</p>}
                    {component.card && <p className="hint">Architecture card: <code>{component.card}</code></p>}
                </Disclosure>
                <Disclosure id="component-screens" title="Screens" count={screens.length} open={graph.sections.screens}
                    onToggle={(open) => graph.setSection('screens', open)}>
                    {screens.length ? <ul className="component-screens">
                        {screens.map((screen) => (
                            <li key={screen}>
                                <button className="btn sm" type="button" onClick={() => vm.openScreen(screen)}>{graph.screenLabel(screen)}</button>
                            </li>
                        ))}
                    </ul> : <p className="hint">Not linked to a screen.</p>}
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

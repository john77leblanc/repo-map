import type { ReactNode } from 'react';
import { observer } from 'mobx-react-lite';
import type { ViewSwitcherViewModel } from './ViewSwitcherViewModel';

const panels = { architecture: 'architecture-workspace', flowchart: 'flowdlg', sitemap: 'sitemap-workspace', components: 'components-workspace' } as const;

/** Architecture · Flowchart · Sitemap (· Components on the map), for the map or the open trace. Missing views stay clickable. */
export const ViewTabs = observer(function ViewTabs({ vm, leading }: { vm: ViewSwitcherViewModel; leading?: ReactNode }) {
    const views = vm.views;
    return (
        <div className="view-tabs">
            {leading && <>{leading}<span className="view-divider" aria-hidden="true" /></>}
            <div className="seg view-tablist" role="tablist" aria-label="Views">
                {views.map((v, i) => {
                    const selected = vm.current === v.id;
                    return (
                        <button
                            key={v.id}
                            className={'btn' + (v.exists ? '' : ' missing')}
                            role="tab"
                            id={'view-tab-' + v.id}
                            aria-controls={vm.showMissing && selected ? 'view-missing' : panels[v.id]}
                            aria-selected={selected}
                            aria-describedby={v.exists || v.busy ? undefined : 'view-tab-missing-note'}
                            aria-busy={v.busy || undefined}
                            tabIndex={selected ? 0 : -1}
                            title={v.busy ? 'Generating…' : v.exists ? undefined : 'Not generated'}
                            onClick={() => vm.show(v.id)}
                            onKeyDown={(event) => {
                                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                                event.preventDefault();
                                const next = event.key === 'Home' ? 0
                                    : event.key === 'End' ? views.length - 1
                                    : (i + (event.key === 'ArrowRight' ? 1 : views.length - 1)) % views.length;
                                vm.show(views[next].id);
                                document.getElementById('view-tab-' + views[next].id)?.focus();
                            }}
                        >
                            {v.label}
                            {v.busy && <span className="busy-dot" aria-hidden="true" />}
                        </button>
                    );
                })}
            </div>
            <span hidden id="view-tab-missing-note">Not generated</span>
            <span className="view-context" title={vm.context}>{vm.context}</span>
        </div>
    );
});

/** Centered in the diagram area when the current view doesn't exist. */
export const MissingView = observer(function MissingView({ vm }: { vm: ViewSwitcherViewModel }) {
    const m = vm.missing;
    return (
        <section className="view-missing" id="view-missing" role="tabpanel" aria-labelledby={'view-tab-' + vm.current}>
            <h2>{m.title}</h2>
            {m.hint && <p className="hint">{m.hint}</p>}
            {m.error && <p className="status err">{m.error}</p>}
            <button className="btn primary" type="button" id="view-missing-action" disabled={m.action.disabled}
                title={m.action.title} onClick={m.action.run}>
                {m.action.label}
            </button>
            {m.action.disabled && m.action.title && <p className="hint">{m.action.title}.</p>}
        </section>
    );
});

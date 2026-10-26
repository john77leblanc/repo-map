import { useEffect, useLayoutEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { CodeReference } from '../../shared/ui/CodeReference';
import { DirectionTabs } from '../../shared/ui/DirectionTabs';
import { CHANGE_LABELS } from '../../../../lib/proposal.mjs';
import { contractLabel } from '../../../../lib/contracts.mjs';
import type { ArchitectureViewModel } from './ArchitectureViewModel';
import { useArchitectureWires } from './useArchitectureWires';
import { DocumentationReference } from './DocumentationReference';
import { ScopeSwitch, WorkspaceBar } from './WorkspaceBar';

export interface ArchitectureWorkspaceProps {
    vm: ArchitectureViewModel;
}
const types = ['http', 'event', 'sync'];
const kinds: Record<string, string> = { service: 'svc', topic: 'topic', external: 'ext' };
const connectionLabels: Record<string, string> = { http: 'HTTP', event: 'event', sync: 'sync' };
const labels: Record<string, string> = {
    http: 'HTTP call',
    event: 'Event',
    sync: 'Data sync / job',
};
const change = (status: string | undefined) =>
    status ? CHANGE_LABELS[status as keyof typeof CHANGE_LABELS] : '';
const Chevron = () => (
    <svg className="chev" viewBox="0 0 10 10">
        <path d="M2 3.5l3 3 3-3" />
    </svg>
);

export const ArchitectureWorkspace = observer(function ArchitectureWorkspace({
    vm,
}: ArchitectureWorkspaceProps) {
    const board = useRef<HTMLDivElement>(null);
    const geometry = useArchitectureWires(board, vm);
    const selected = vm.inspected;
    useEffect(() => {
        const listener = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !document.querySelector('dialog:modal')) {
                e.preventDefault();
                vm.dismiss();
            }
        };
        document.addEventListener('keydown', listener);
        return () => document.removeEventListener('keydown', listener);
    }, [vm]);
    useLayoutEffect(() => {
        if (!vm.revealId) return;
        const el = Array.from(board.current?.querySelectorAll<HTMLElement>('.node') || []).find(
            (n) => n.dataset.id === vm.revealId
        );
        el?.scrollIntoView?.({
            block: 'center',
            inline: 'center',
            behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
                ? 'auto'
                : 'smooth',
        });
    }, [vm.revealVersion, vm]);
    const wire = (w: (typeof geometry.wires)[number], i: number, overlay = false) => {
        const e = w.edges[0],
            on = w.edges.some((e) => vm.wireOn(e.from, e.to));
        return (
            <path
                key={i}
                id={overlay ? undefined : 'proposal-wire-' + i}
                d={w.d}
                className={`w ${e.type}${e.inferred ? ' inf' : ''}${w.edges.some((x) => x.seam) ? ' seam' : ''}${e.status ? ' change-' + e.status : ''}${on ? ' on' : ''}`}
                markerEnd={`url(#m-${e.type})`}
            />
        );
    };
    const edgeLabels = vm.repo.bootstrap?.config.edgeTypes as Record<string, string> | undefined;
    return (
        <section id="architecture-workspace" aria-label="Architecture">
            <header className="top" style={{ flex: 'none' }}>
                <div className="canvas-controls">
                    <div className="controls">
                        <label className="search">
                            <svg viewBox="0 0 16 16" strokeWidth="1.6">
                                <circle cx="7" cy="7" r="5" />
                                <path d="M11 11l3.5 3.5" />
                            </svg>
                            <input
                                id="q"
                                type="search"
                                placeholder="Find a node"
                                aria-label="Find a node"
                                value={vm.query}
                                onChange={(e) => vm.setQuery(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        vm.searchEnter();
                                    }
                                }}
                            />
                        </label>
                        <button
                            className="btn"
                            id="expand"
                            type="button"
                            onClick={() => vm.expand(true)}
                        >
                            Expand groups
                        </button>
                        <button
                            className="btn"
                            id="collapse"
                            type="button"
                            onClick={() => vm.expand(false)}
                        >
                            Collapse groups
                        </button>
                        <button
                            className="btn key-toggle"
                            id="architecture-key-toggle"
                            type="button"
                            aria-expanded={vm.keyOpen}
                            aria-controls="architecture-key"
                            onClick={vm.toggleKey}
                        >
                            Diagram key
                        </button>
                        <ScopeSwitch vm={vm} />
                    </div>
                </div>
            </header>
            <WorkspaceBar vm={vm} />
            <section
                className="diagram-key"
                id="architecture-key"
                aria-label="Diagram key"
                hidden={!vm.keyOpen}
            >
                <div className="legend" role="group" aria-label="Connection types">
                    {types.map((t) => (
                        <button
                            key={t}
                            className="chip"
                            type="button"
                            data-type={t}
                            aria-pressed={!vm.hidden[t]}
                            onClick={() => vm.toggleType(t)}
                        >
                            <i className={'sw ' + t} />
                            <span data-lbl={t}>{edgeLabels?.[t] || labels[t]}</span>
                        </button>
                    ))}
                    <span className="chip" style={{ cursor: 'default' }}>
                        <i className="sw inf" />
                        Inferred
                    </span>
                    {vm.scope === 'workspace' && (
                        <span className="chip" style={{ cursor: 'default' }} data-key-seam>
                            <i className="sw seam" />
                            Between repos
                        </span>
                    )}
                    <span className="note">
                        {['service', 'topic', 'external'].map((k) => (
                            <span key={k}>
                                <i
                                    className="kd"
                                    style={{
                                        background: `var(--${kinds[k]})`,
                                        transform: k === 'topic' ? 'rotate(45deg)' : undefined,
                                        borderRadius: k === 'external' ? '50%' : undefined,
                                    }}
                                />
                                <span data-kind={k}>
                                    {vm.repo.bootstrap?.config.kinds?.[k] ||
                                        (k === 'external' ? 'outside the repo' : k)}
                                </span>{' '}
                            </span>
                        ))}
                    </span>
                    <span className="note">
                        Arrows point from caller to callee, publisher to topic to subscriber, and
                        source to destination for syncs. Hover a card to trace it; click to open it.
                    </span>
                </div>
                <p data-proposal-key className="proposal-legend" hidden={!vm.trace?.proposal}>
                    Proposed changes: <span className="key-change">New</span>{' '}
                    <span className="key-change modified">Modified</span>{' '}
                    <span className="key-change removed">Removed</span>
                </p>
            </section>
            <div className={'arch-stage' + (selected ? ' details-open' : '')}>
                <div className="scroller" id="scroller">
                    <p className="empty" id="map-empty" hidden={!!vm.map.nodes.length}>
                        This map is empty. Open Settings to redraw it with an AI tool.
                    </p>
                    <div
                        className={'board' + (vm.active || vm.trace ? ' focusing' : '')}
                        id="board"
                        ref={board}
                    >
                        <svg
                            id="wires"
                            className="wires"
                            aria-hidden="true"
                            width={geometry.width}
                            height={geometry.height}
                        >
                            <defs>
                                {types.map((t) => (
                                    <marker
                                        key={t}
                                        id={'m-' + t}
                                        viewBox="0 0 8 8"
                                        refX="7"
                                        refY="4"
                                        markerWidth="7"
                                        markerHeight="7"
                                        orient="auto-start-reverse"
                                    >
                                        <path
                                            d="M0 0.5L7.5 4L0 7.5z"
                                            style={{ fill: `var(--${t})` }}
                                        />
                                    </marker>
                                ))}
                            </defs>
                            {geometry.wires.map((w, i) => wire(w, i))}
                        </svg>
                        <div className="cols" id="cols" onMouseLeave={() => vm.setHover(null)}>
                            {vm.repo.bootstrap?.config.columns.map((c, ci) => (
                                <div className="col" key={ci}>
                                    <div className="colh">
                                        {c.title}
                                        <small>{c.subtitle}</small>
                                    </div>
                                    {vm.map.groups
                                        .filter((g) => g.col === ci)
                                        .map((g) => (
                                            <details
                                                key={g.id}
                                                className={
                                                    'grp' +
                                                    (vm.groupDim(g.id) ? ' dimg' : '') +
                                                    (vm.map.nodes.some(
                                                        (n) =>
                                                            n.group === g.id && vm.step(n.id) >= 0
                                                    )
                                                        ? ' trg'
                                                        : '') +
                                                    (!vm.isOpen(g.id) &&
                                                    vm.map.nodes.some(
                                                        (n) =>
                                                            n.group === g.id &&
                                                            vm.relevant?.has(n.id) &&
                                                            !vm.active?.has(n.id)
                                                    )
                                                        ? ' nbr'
                                                        : '')
                                                }
                                                data-g={g.id}
                                                open={vm.isOpen(g.id)}
                                                onToggle={(e) =>
                                                    vm.setGroup(g.id, e.currentTarget.open)
                                                }
                                            >
                                                <summary
                                                    onMouseEnter={() => vm.setHover('g:' + g.id)}
                                                    onMouseLeave={() => vm.setHover(null)}
                                                >
                                                    <svg className="car" viewBox="0 0 10 10">
                                                        <path d="M3.5 2l3 3-3 3" />
                                                    </svg>
                                                    {!g.id.startsWith('repo:') && vm.repoTitle(g.repo) && (
                                                        <span className="repo-tag">{vm.repoTitle(g.repo)}</span>
                                                    )}
                                                    <span>{g.title}</span>
                                                    <span className="gc">
                                                        {
                                                            vm.map.nodes.filter(
                                                                (n) => n.group === g.id
                                                            ).length
                                                        }
                                                    </span>
                                                </summary>
                                                <div className="gl">
                                                    {g.note && <p className="gnote">{g.note}</p>}
                                                    {vm.map.nodes
                                                        .filter((n) => n.group === g.id)
                                                        .map((n) => (
                                                            <div
                                                                key={n.id}
                                                                data-id={n.id}
                                                                className={
                                                                    'node k-' +
                                                                    (kinds[n.kind] || 'svc') +
                                                                    (n.status
                                                                        ? ' change-' + n.status
                                                                        : '') +
                                                                    (n.collapsed ? ' collapsed' : '') +
                                                                    (vm.selected === n.id
                                                                        ? ' open'
                                                                        : '') +
                                                                    (vm.matches(n)
                                                                        ? ' match'
                                                                        : '') +
                                                                    (vm.step(n.id) >= 0
                                                                        ? ' trn'
                                                                        : '') +
                                                                    (vm.active?.has(n.id)
                                                                        ? ' act'
                                                                        : vm.active &&
                                                                            vm.relevant?.has(n.id)
                                                                          ? ' nbr'
                                                                          : '') +
                                                                    (vm.relevant &&
                                                                    !vm.relevant.has(n.id) &&
                                                                    !vm.groupDim(g.id)
                                                                        ? ' dimn'
                                                                        : '')
                                                                }
                                                            >
                                                                <button
                                                                    className="nh"
                                                                    type="button"
                                                                    aria-expanded={
                                                                        vm.selected === n.id
                                                                    }
                                                                    aria-controls="arch-details"
                                                                    onClick={() =>
                                                                        vm.toggleNode(n.id)
                                                                    }
                                                                    onMouseEnter={() =>
                                                                        vm.setHover(n.id)
                                                                    }
                                                                    onMouseLeave={() =>
                                                                        vm.setHover(null)
                                                                    }
                                                                    onFocus={() =>
                                                                        vm.setHover(n.id)
                                                                    }
                                                                    onBlur={() => vm.setHover(null)}
                                                                >
                                                                    <span className="dot" />
                                                                    {vm.step(n.id) >= 0 && (
                                                                        <span className="stepn">
                                                                            {vm.step(n.id) + 1}
                                                                        </span>
                                                                    )}
                                                                    <span className="nm">
                                                                        {n.title || n.id}
                                                                    </span>
                                                                    {n.collapsed && (
                                                                        <span className="dcount" title={`${n.members?.length} cards folded into one`}>
                                                                            {n.members?.length} cards
                                                                        </span>
                                                                    )}
                                                                    {!!vm.repo.docs[n.id]
                                                                        ?.length && (
                                                                        <span
                                                                            className="dcount"
                                                                            title={`${vm.repo.docs[n.id].length} linked documentation section${vm.repo.docs[n.id].length === 1 ? '' : 's'}`}
                                                                        >
                                                                            <svg
                                                                                viewBox="0 0 10 10"
                                                                                aria-hidden="true"
                                                                            >
                                                                                <path d="M2 1h4l2 2v6H2z M6 1v2h2" />
                                                                            </svg>
                                                                            {
                                                                                vm.repo.docs[n.id]
                                                                                    .length
                                                                            }
                                                                        </span>
                                                                    )}
                                                                    {n.tag && (
                                                                        <span
                                                                            className="bu"
                                                                            title={
                                                                                'services/' + n.tag
                                                                            }
                                                                        >
                                                                            {n.tag === 'membership'
                                                                                ? 'mem'
                                                                                : n.tag}
                                                                        </span>
                                                                    )}
                                                                    <Chevron />
                                                                    {n.status && (
                                                                        <span className="proposal-badge">
                                                                            {change(n.status)}
                                                                        </span>
                                                                    )}
                                                                </button>
                                                                <div className="nb" hidden />
                                                            </div>
                                                        ))}
                                                </div>
                                            </details>
                                        ))}
                                </div>
                            ))}
                        </div>
                        <svg
                            id="wires-top"
                            className="wires"
                            aria-hidden="true"
                            width={geometry.width}
                            height={geometry.height}
                        >
                            {geometry.wires.map((w, i) =>
                                w.edges.some((e) => vm.wireOn(e.from, e.to))
                                    ? wire(w, i, true)
                                    : null
                            )}
                            {geometry.wires.map((w, i) =>
                                w.edges[0].status ? (
                                    <text key={i} className="wire-change-label">
                                        <textPath
                                            href={'#proposal-wire-' + i}
                                            startOffset="50%"
                                            textAnchor="middle"
                                        >
                                            {change(w.edges[0].status)}
                                        </textPath>
                                    </text>
                                ) : null
                            )}
                        </svg>
                    </div>
                </div>
                {selected && (
                    <aside
                        className="fside arch-side"
                        id="arch-details"
                        aria-labelledby="arch-details-title"
                        aria-live="polite"
                        data-id={selected.id}
                    >
                        <div className="fside-head">
                            <h3 id="arch-details-title">
                                {selected.title || selected.id}
                                {selected.status && ' '}
                                {selected.status && (
                                    <span className={'proposal-badge ' + selected.status}>{change(selected.status)}</span>
                                )}
                            </h3>
                            <button className="btn sm" type="button" data-close onClick={vm.dismiss}>Close</button>
                        </div>
                        {selected.collapsed ? (
                            <CollapsedRepoDetails vm={vm} id={selected.id} />
                        ) : (
                        <div className="arch-details-body">
                        {vm.repoTitle(selected.repo) && <p className="hint repo-of">From <b>{vm.repoTitle(selected.repo)}</b></p>}
                        <p className="description">
                            {selected.desc ||
                                (selected.status === 'new' ? selected.rationale : '')}
                        </p>
                        {selected.status && (
                            <p className="proposal-note">
                                {change(selected.status)}: {selected.rationale}
                                {selected.suggestedPath
                                    ? ' Suggested path: ' + selected.suggestedPath
                                    : ''}
                            </p>
                        )}
                        <ul className="facts">
                            {selected.facts?.map((f, i) => (
                                <li key={i}>{f}</li>
                            ))}
                        </ul>
                        {(['provides', 'consumes'] as const).map((field) => selected[field]?.length ? (
                            <section key={field} className="contracts" data-contracts={field}>
                                <h4>{field === 'provides' ? 'Serves to other repos' : 'Calls in other repos'}</h4>
                                <ul className="facts">
                                    {selected[field]!.map((key) => <li key={key} title={key}>{contractLabel(key)}</li>)}
                                </ul>
                            </section>
                        ) : null)}
                        <div className="refs">
                            {vm.trace?.steps.map((s, i) =>
                                s.id === selected.id ? (
                                    <section key={i} className="arch-step">
                                        <h3>
                                            <span
                                                className="arch-step-number"
                                                aria-label={'Step ' + (i + 1)}
                                            >
                                                {i + 1}
                                            </span>
                                            <span>Trace step</span>
                                        </h3>
                                        <p>{s.note}</p>
                                        {vm.trace?.refs
                                            .filter((r) => r.step === selected.id)
                                            .map((r, j) => (
                                                <CodeReference
                                                    key={selected.id + r.path + j}
                                                    reference={r}
                                                    repo={vm.repo}
                                                />
                                            ))}
                                    </section>
                                ) : null
                            )}
                            {vm.repo.docs[selected.id]?.map((r, i) => (
                                <DocumentationReference
                                    key={selected.id + r.path + i}
                                    reference={r}
                                    repo={vm.repo}
                                />
                            ))}
                        </div>
                        <CardSeams vm={vm} id={selected.id} />
                        <CardConnections vm={vm} id={selected.id} />
                        {selected.path && (
                            <p className="path">
                                {vm.repo.bootstrap?.repo.ghBase ? (
                                    <a
                                        href={`${vm.repo.bootstrap.repo.ghBase}/tree/${vm.repo.bootstrap.repo.ghRef || 'HEAD'}/${selected.path}`}
                                        target="_blank"
                                        rel="noopener"
                                    >
                                        {selected.path}
                                    </a>
                                ) : (
                                    selected.path
                                )}
                            </p>
                        )}
                        </div>
                        )}
                    </aside>
                )}
            </div>
        </section>
    );
});

/** A collapsed repo: the cards it hides, each opening that card, and Expand. */
const CollapsedRepoDetails = observer(function CollapsedRepoDetails({ vm, id }: { vm: ArchitectureViewModel; id: string }) {
    const node = vm.nodes.get(id)!;
    const all = vm.workspace?.view?.map.nodes || [];
    return (
        <div className="arch-details-body">
            <p className="description">
                {node.members?.length} cards from <b>{node.title}</b> are folded into this card. Its connections to other repos still show.
            </p>
            <button className="btn sm" type="button" id="arch-expand-repo" onClick={() => vm.expandCollapsed(id)}>
                Expand
            </button>
            <h4>Hidden cards</h4>
            <ul className="ws-members">
                {node.members?.map((m) => (
                    <li key={m}>
                        <button className="cl" type="button" data-member={m} onClick={() => vm.expandCollapsed(id, m)}>
                            {all.find((n) => n.id === m)?.title || m}
                        </button>
                    </li>
                ))}
            </ul>
            <CardSeams vm={vm} id={id} />
            <CardConnections vm={vm} id={id} />
        </div>
    );
});

const HOW = { contract: 'matched contract', ai: 'found by AI', manual: 'added by hand' } as const;

/** Connections to other repos: how each was found, and the code behind it. */
const CardSeams = observer(function CardSeams({ vm, id }: { vm: ArchitectureViewModel; id: string }) {
    const seams = vm.seamsFor(id);
    if (!seams.length) return null;
    return (
        <section className="seams" aria-label="Connections to other repos">
            <h4>Connections to other repos</h4>
            <ul>
                {seams.map((e) => {
                    const other = e.from === id ? e.to : e.from;
                    return (
                        <li key={e.from + '>' + e.to} data-seam={e.from + '>' + e.to}>
                            <button className="cl" type="button" onClick={() => vm.inspect(other)}>
                                <i className="sw seam" />
                                <b>{(e.from === id ? '→ ' : '← ') + vm.nodeTitle(other)}</b>
                                <span>{e.label}</span>
                                <em>{HOW[e.seam!]}</em>
                            </button>
                            {e.why && <p className="hint">{e.why}</p>}
                            {e.refs?.map((r, i) => <CodeReference key={r.path + i} reference={r} repo={vm.repo} />)}
                            {e.seam !== 'contract' && (
                                <button className="btn sm" type="button" data-remove-seam onClick={() => void vm.workspace?.removeSeam(e)}>
                                    Remove connection
                                </button>
                            )}
                        </li>
                    );
                })}
            </ul>
        </section>
    );
});

/** A card's connections, split into From (arriving) and To (leaving) tabs. */
const CardConnections = observer(function CardConnections({ vm, id }: { vm: ArchitectureViewModel; id: string }) {
    const conns = vm.connectionsFor(id);
    if (!conns.from.length && !conns.to.length) {
        return <div className="conn"><h4>Connections</h4><p className="hint">No connections.</p></div>;
    }
    return (
        <section className="conn" aria-label="Connections">
            <h4>Connections</h4>
            <DirectionTabs idPrefix={'arch-conn-' + id} label="Connection direction" active={vm.connectionTab}
                onChange={vm.setConnectionTab}
                tabs={[{ id: 'from', label: 'From', count: conns.from.length }, { id: 'to', label: 'To', count: conns.to.length }]}>
                {(active) => (
                    <ul>
                        {conns[active].map(({ edge: e, other }, i) => (
                            <li key={active + i}>
                                <button className="cl" type="button" data-go={other} onClick={() => vm.inspect(other)}
                                    onMouseEnter={() => vm.setHover(other)} onMouseLeave={() => vm.setHover(null)}
                                    onFocus={() => vm.setHover(other)} onBlur={() => vm.setHover(null)}>
                                    <i className={'sw ' + e.type} />
                                    <b>{vm.nodeTitle(other)}</b>
                                    <span>{[change(e.status), e.label || connectionLabels[e.type]].filter(Boolean).join(': ')}</span>
                                    {e.inferred && <em>inferred</em>}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </DirectionTabs>
        </section>
    );
});

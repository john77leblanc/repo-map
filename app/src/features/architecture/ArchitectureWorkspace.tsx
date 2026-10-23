import { useEffect, useLayoutEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { CodeReference } from '../../shared/ui/CodeReference';
import { CHANGE_LABELS } from '../../../../lib/proposal.mjs';
import type { ArchitectureViewModel } from './ArchitectureViewModel';
import { useArchitectureWires } from './useArchitectureWires';
import { DocumentationReference } from './DocumentationReference';

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
    const board = useRef<HTMLDivElement>(null),
        dialog = useRef<HTMLDialogElement>(null);
    const geometry = useArchitectureWires(board, vm);
    const selected = vm.inspected;
    useLayoutEffect(() => {
        const el = dialog.current;
        if (!el) return;
        if (selected) {
            if (!el.open) el.show();
            el.querySelector<HTMLButtonElement>('[data-close]')?.focus({ preventScroll: true });
        } else if (el.open) el.close();
    }, [selected?.id]);
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
                className={`w ${e.type}${e.inferred ? ' inf' : ''}${e.status ? ' change-' + e.status : ''}${on ? ' on' : ''}`}
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
                    </div>
                </div>
            </header>
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
            <div className="arch-stage">
                <div className="scroller" id="scroller">
                    <p className="empty" id="map-empty" hidden={!!vm.map.nodes.length}>
                        This map is empty. Open Settings to draw a map, or run{' '}
                        <code>repo-map generate</code>, then reload.
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
                                                >
                                                    <svg className="car" viewBox="0 0 10 10">
                                                        <path d="M3.5 2l3 3-3 3" />
                                                    </svg>
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
                                                                    aria-haspopup="dialog"
                                                                    onClick={() =>
                                                                        vm.toggleNode(n.id)
                                                                    }
                                                                    onMouseEnter={() =>
                                                                        vm.setHover(n.id)
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
                <div
                    className="arch-details-shade"
                    hidden={!selected}
                    aria-hidden="true"
                    onClick={vm.dismiss}
                />
                <dialog
                    ref={dialog}
                    id="arch-details"
                    hidden={!selected}
                    aria-labelledby="arch-details-title"
                    aria-modal="false"
                    data-id={selected?.id}
                    onCancel={(e) => {
                        e.preventDefault();
                        vm.dismiss();
                    }}
                >
                    {selected && (
                        <>
                            <button
                                className="btn sm"
                                type="button"
                                data-close
                                onClick={vm.dismiss}
                            >
                                Close details
                            </button>
                            <h2 id="arch-details-title">{selected.title || selected.id}</h2>
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
                            <div className="conn">
                                <h4>Connections</h4>
                                <ul>
                                    {['in', 'out'].flatMap((dir) =>
                                        vm.map.edges
                                            .filter(
                                                (e) =>
                                                    (dir === 'in' ? e.to : e.from) === selected.id
                                            )
                                            .map((e, i) => {
                                                const id = dir === 'in' ? e.from : e.to;
                                                return (
                                                    <li key={dir + i}>
                                                        <button
                                                            className="cl"
                                                            type="button"
                                                            data-go={id}
                                                            onClick={() => vm.inspect(id)}
                                                        >
                                                            <i className={'sw ' + e.type} />
                                                            <b>{vm.nodes.get(id)?.title || id}</b>
                                                            <span>
                                                                {[
                                                                    change(e.status),
                                                                    e.label ||
                                                                        connectionLabels[e.type],
                                                                ]
                                                                    .filter(Boolean)
                                                                    .join(': ')}
                                                            </span>
                                                            {e.inferred && <em>inferred</em>}
                                                        </button>
                                                    </li>
                                                );
                                            })
                                    )}
                                </ul>
                            </div>
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
                        </>
                    )}
                </dialog>
            </div>
        </section>
    );
});

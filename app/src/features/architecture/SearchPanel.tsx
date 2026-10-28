import { useLayoutEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import type { ArchitectureViewModel } from './ArchitectureViewModel';

const kinds: Record<string, string> = { service: 'svc', topic: 'topic', external: 'ext' };
const optionId = (id: string) => 'arch-hit-' + id.replace(/[^\w-]/g, '_');

export const SearchIcon = () => (
    <svg viewBox="0 0 16 16" strokeWidth="1.6" aria-hidden="true">
        <circle cx="7" cy="7" r="5" />
        <path d="M11 11l3.5 3.5" />
    </svg>
);

/** Search results in the side panel: cards by column, then group. Picking one opens it. */
export const SearchPanel = observer(function SearchPanel({ vm }: { vm: ArchitectureViewModel }) {
    const list = useRef<HTMLDivElement>(null);
    const hits = vm.searchHits;
    const active = hits[vm.searchCursor];
    useLayoutEffect(() => {
        if (!active) return;
        list.current?.querySelector('#' + optionId(active))?.scrollIntoView?.({ block: 'nearest' });
    }, [active]);
    let index = 0;
    return (
        <>
            <label className="search arch-search">
                <SearchIcon />
                <input
                    id="q"
                    type="search"
                    placeholder="Find a node"
                    aria-label="Find a node"
                    autoFocus
                    autoComplete="off"
                    role="combobox"
                    aria-expanded="true"
                    aria-controls="arch-search-results"
                    aria-activedescendant={active ? optionId(active) : undefined}
                    value={vm.query}
                    onChange={(e) => vm.setQuery(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                            e.preventDefault();
                            vm.moveCursor(e.key === 'ArrowDown' ? 1 : -1);
                        } else if (e.key === 'Enter') {
                            e.preventDefault();
                            vm.searchEnter();
                        }
                    }}
                />
            </label>
            <div className="arch-search-results" id="arch-search-results" role="listbox" aria-label="Matching nodes" ref={list}>
                {!hits.length && <p className="hint">No nodes match.</p>}
                {vm.searchSections.map((c) => (
                    <section key={c.col} className="search-col" role="group" aria-label={c.title}>
                        <h4>{c.title}</h4>
                        {c.groups.map((g) => (
                            <div key={g.id} className="search-grp" role="group" aria-label={g.title}>
                                <h5>
                                    {vm.repoTitle(g.repo) && <span className="repo-tag">{vm.repoTitle(g.repo)}</span>}
                                    <span>{g.title}</span>
                                </h5>
                                {g.nodes.map(({ node: n, snippet }) => {
                                    const i = index++;
                                    return (
                                        <div
                                            key={n.id}
                                            id={optionId(n.id)}
                                            role="option"
                                            aria-selected={i === vm.searchCursor}
                                            data-hit={n.id}
                                            className={'search-hit k-' + (kinds[n.kind] || 'svc') + (i === vm.searchCursor ? ' cur' : '')}
                                            onClick={() => {
                                                vm.setCursor(i);
                                                vm.inspect(n.id);
                                            }}
                                            onMouseEnter={() => vm.setHover(n.id)}
                                            onMouseLeave={() => vm.setHover(null)}
                                        >
                                            <span className="dot" />
                                            <b>{n.title || n.id}</b>
                                            {snippet && (
                                                <span className="snip">
                                                    {snippet.before}
                                                    <mark>{snippet.hit}</mark>
                                                    {snippet.after}
                                                </span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                    </section>
                ))}
            </div>
        </>
    );
});

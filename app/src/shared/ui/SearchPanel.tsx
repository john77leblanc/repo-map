import { useLayoutEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import type { SearchModel } from '../search/SearchModel';

const SearchIcon = () => (
    <svg viewBox="0 0 16 16" strokeWidth="1.6" aria-hidden="true">
        <circle cx="7" cy="7" r="5" />
        <path d="M11 11l3.5 3.5" />
    </svg>
);

interface SearchPanelProps {
    search: SearchModel;
    /** Id prefix for the results list and options (`<prefix>-search-results`, `<prefix>-hit-<id>`). */
    prefix: string;
    /** The input's id; defaults to `<prefix>-q`. */
    inputId?: string;
    /** Accessible name and placeholder, e.g. "Find a screen". */
    label: string;
    /** Accessible name of the results list, e.g. "Matching screens". */
    listLabel: string;
    /** Shown when nothing matches. */
    empty: string;
    onPick: (id: string) => void;
    onHover?: (id: string | null) => void;
}

/** Search box and results for a diagram's side panel: hits by section, then group. Picking one opens it. */
const SearchPanel = observer(function SearchPanel({ search, prefix, inputId = prefix + '-q', label, listLabel, empty,
    onPick, onHover }: SearchPanelProps) {
    const list = useRef<HTMLDivElement>(null);
    const optionId = (id: string) => prefix + '-hit-' + id.replace(/[^\w-]/g, '_');
    const active = search.current;
    useLayoutEffect(() => {
        if (!active) return;
        list.current?.querySelector('#' + optionId(active))?.scrollIntoView?.({ block: 'nearest' });
    }, [active]);
    let index = 0;
    return (
        <>
            <label className="search side-search">
                <SearchIcon />
                <input
                    id={inputId}
                    type="search"
                    placeholder={label}
                    aria-label={label}
                    autoFocus
                    autoComplete="off"
                    role="combobox"
                    aria-expanded="true"
                    aria-controls={prefix + '-search-results'}
                    aria-activedescendant={active ? optionId(active) : undefined}
                    value={search.query}
                    onChange={(e) => search.setQuery(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                            e.preventDefault();
                            search.move(e.key === 'ArrowDown' ? 1 : -1);
                        } else if (e.key === 'Enter') {
                            e.preventDefault();
                            if (search.current) onPick(search.current);
                        }
                    }}
                />
            </label>
            <div className="search-results" id={prefix + '-search-results'} role="listbox" aria-label={listLabel} ref={list}>
                {!search.hits.length && <p className="hint">{empty}</p>}
                {search.sections.map((s) => (
                    <section key={s.id} className="search-col" role="group" aria-label={s.title}>
                        <h4>{s.title}</h4>
                        {s.groups.map((g) => (
                            <div key={g.id} className="search-grp" role="group" aria-label={g.title || undefined}>
                                {(g.title || g.tag) && (
                                    <h5>
                                        {g.tag && <span className="repo-tag">{g.tag}</span>}
                                        <span>{g.title}</span>
                                    </h5>
                                )}
                                {g.hits.map(({ item, snippet }) => {
                                    const i = index++;
                                    return (
                                        <div
                                            key={item.id}
                                            id={optionId(item.id)}
                                            role="option"
                                            aria-selected={i === search.cursor}
                                            data-hit={item.id}
                                            className={'search-hit k-' + (item.kind || 'svc') + (i === search.cursor ? ' cur' : '')}
                                            onClick={() => {
                                                search.setCursor(i);
                                                onPick(item.id);
                                            }}
                                            onMouseEnter={() => onHover?.(item.id)}
                                            onMouseLeave={() => onHover?.(null)}
                                        >
                                            <span className="dot" />
                                            <b>{item.title}</b>
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

/** The toolbar button that opens (or closes) a view's search. */
function SearchToggle({ id, controls, open, onToggle }: { id: string; controls: string; open: boolean; onToggle: () => void }) {
    return (
        <button className="btn search-toggle" id={id} type="button" title="Search (/ or Ctrl+K)"
            aria-expanded={open} aria-controls={controls} onClick={onToggle}>
            <SearchIcon />
            Search
        </button>
    );
}

/** The "← Results" button above a picked item's panel header while search is open. */
function BackToResults({ id, onClick }: { id: string; onClick: () => void }) {
    return <button className="btn sm search-back" type="button" id={id} onClick={onClick}>← Results</button>;
}

export { BackToResults, SearchIcon, SearchPanel, SearchToggle };

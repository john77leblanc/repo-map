import type { KeyboardEvent, ReactNode } from 'react';

export interface DirectionTab<T extends string> {
    id: T;
    label: string;
    count: number;
}
export interface DirectionTabsProps<T extends string> {
    /** Unique per instance; used for tab and panel ids. */
    idPrefix: string;
    label: string;
    tabs: DirectionTab<T>[];
    active: T;
    onChange: (tab: T) => void;
    className?: string;
    children: (active: T) => ReactNode;
}

/** The tab actually shown: the requested one, or the first with items when it is empty. */
export function shownTab<T extends string>(tabs: DirectionTab<T>[], active: T): T {
    return tabs.find((t) => t.id === active && t.count)?.id ?? tabs.find((t) => t.count)?.id ?? active;
}

function onArrow(e: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const buttons = [...(e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)') || [])];
    const index = buttons.indexOf(e.currentTarget);
    const target = buttons[e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1
        : (index + (e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length];
    if (target) { target.focus(); target.click(); }
}

/** From/To style tabs with counts, roving focus and arrow keys. Empty tabs are disabled. */
export function DirectionTabs<T extends string>({ idPrefix, label, tabs, active: requested, onChange, className = '', children }: DirectionTabsProps<T>) {
    const active = shownTab(tabs, requested);
    const panel = `${idPrefix}-${active}`;
    return (
        <>
            <div className={'direction-tabs ' + className} role="tablist" aria-label={label}>
                {tabs.map((tab) => (
                    <button key={tab.id} type="button" role="tab" id={`${idPrefix}-${tab.id}-tab`}
                        aria-selected={active === tab.id} aria-controls={panel} tabIndex={active === tab.id ? 0 : -1}
                        disabled={!tab.count} onClick={() => onChange(tab.id)} onKeyDown={onArrow}>
                        {tab.label} ({tab.count})
                    </button>
                ))}
            </div>
            <div role="tabpanel" id={panel} aria-labelledby={`${idPrefix}-${active}-tab`}>
                {children(active)}
            </div>
        </>
    );
}

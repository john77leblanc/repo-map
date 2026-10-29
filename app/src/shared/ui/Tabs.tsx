import type { KeyboardEvent, ReactNode } from 'react';

export interface TabItem<T extends string> {
    id: T;
    label: string;
    /** How many items the tab holds, shown as "Label (n)"; a tab with 0 is disabled. */
    count?: number;
    disabled?: boolean;
}
export interface TabsProps<T extends string> {
    /** Unique per instance; used for tab and panel ids. */
    idPrefix: string;
    label: string;
    tabs: TabItem<T>[];
    active: T;
    onChange: (tab: T) => void;
    className?: string;
    /** Class for the panel, e.g. `modal-body` to make it the scrolling part under fixed tabs. */
    panelClassName?: string;
    children: (active: T) => ReactNode;
}

/** Can the tab be chosen? Not when disabled, or when it counts no items. */
const usable = <T extends string>(tab: TabItem<T>) => !tab.disabled && tab.count !== 0;

/** The tab actually shown: the requested one, or the first usable one when it can't be. */
export function shownTab<T extends string>(tabs: TabItem<T>[], active: T): T {
    return tabs.find((t) => t.id === active && usable(t))?.id ?? tabs.find(usable)?.id ?? active;
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

/**
 * Underlined tabs with roving focus and arrow keys, and one panel for the active
 * tab: From/To connections (with counts; empty tabs are disabled) and the review modes.
 */
export function Tabs<T extends string>({ idPrefix, label, tabs, active: requested, onChange, className = '', panelClassName, children }: TabsProps<T>) {
    const active = shownTab(tabs, requested);
    const panel = `${idPrefix}-${active}`;
    return (
        <>
            <div className={'tab-row ' + className} role="tablist" aria-label={label}>
                {tabs.map((tab) => (
                    <button key={tab.id} type="button" role="tab" id={`${idPrefix}-${tab.id}-tab`}
                        aria-selected={active === tab.id} aria-controls={panel} tabIndex={active === tab.id ? 0 : -1}
                        disabled={!usable(tab)} onClick={() => onChange(tab.id)} onKeyDown={onArrow}>
                        {tab.label}{tab.count !== undefined && ` (${tab.count})`}
                    </button>
                ))}
            </div>
            <div role="tabpanel" className={panelClassName} id={panel} aria-labelledby={`${idPrefix}-${active}-tab`}>
                {children(active)}
            </div>
        </>
    );
}

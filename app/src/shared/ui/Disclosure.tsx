import type { HTMLAttributes, ReactNode } from 'react';

export interface DisclosureListProps {
    /** `ol` for ordered rows such as journey steps. */
    ordered?: boolean;
    className?: string;
    children: ReactNode;
}

/** A bordered list of `Disclosure` rows, divided by lines. */
export function DisclosureList({ ordered, className, children }: DisclosureListProps) {
    const List = ordered ? 'ol' : 'ul';
    return <List className={'disclosure-list' + (className ? ' ' + className : '')}>{children}</List>;
}

export interface DisclosureProps {
    /** Id of the body; the header button gets `headId` (default `<id>-head`). */
    id: string;
    headId?: string;
    title: ReactNode;
    /** Right-aligned badge, e.g. how many items the row holds, or progress such as `2/5`. */
    count?: number | string;
    /** Extra class for the badge (the plan marks finished progress). */
    countClassName?: string;
    open: boolean;
    onToggle: (open: boolean) => void;
    /** Extra props for the header button (hover and focus handlers). */
    headProps?: Omit<HTMLAttributes<HTMLButtonElement>, 'id' | 'onClick' | 'aria-expanded' | 'aria-controls'>;
    children: ReactNode;
}

/** One collapsible row: a full-width header button and, while open, its body. Open state is owned by the view model. */
export function Disclosure({ id, headId = id + '-head', title, count, countClassName, open, onToggle, headProps, children }: DisclosureProps) {
    return (
        <li className="disclosure" data-section={id}>
            <button {...headProps} className="disclosure-head" type="button" id={headId} aria-expanded={open}
                aria-controls={id} onClick={() => onToggle(!open)}>
                <span className="disclosure-title">{title}</span>
                {count != null && <>{' '}<span className={'disclosure-count' + (countClassName ? ' ' + countClassName : '')}>{count}</span></>}
            </button>
            {open && (
                <div className="disclosure-body" id={id} role="region" aria-labelledby={headId}>
                    {children}
                </div>
            )}
        </li>
    );
}

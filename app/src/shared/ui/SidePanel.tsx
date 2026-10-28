import type { HTMLAttributes, ReactNode } from 'react';
import { CHANGE_LABELS } from '../../../../lib/proposal.mjs';
import type { ChangeStatus } from '../../models/types';

type CloseEvent = { currentTarget: HTMLElement };

export interface SidePanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
    id: string;
    title: ReactNode;
    titleId?: string;
    onClose: (event: CloseEvent) => void;
    closeId?: string;
    /** Proposal change, shown as a chip on the row under the header. */
    status?: ChangeStatus;
    /** What the item is (e.g. "Step — Decision"), on the row under the header after the chip. */
    kind?: ReactNode;
    /** Shown above the header, e.g. a back button. */
    before?: ReactNode;
    /** Escape inside the panel closes it. Off when the view handles Escape itself. */
    closeOnEscape?: boolean;
    'data-id'?: string;
}

/**
 * The diagram side panel shared by every view: an `.fside` aside that starts with one
 * sticky row (title, then Close), then an optional row with the change chip and kind.
 * Escape inside it closes it too.
 */
export function SidePanel({ id, title, titleId = id + '-title', onClose, closeId, status, kind, before, closeOnEscape = true,
    className, children, onKeyDown, ...rest }: SidePanelProps) {
    return (
        <aside {...rest} id={id} className={'fside' + (className ? ' ' + className : '')}
            aria-labelledby={rest['aria-label'] ? undefined : titleId}
            onKeyDown={(event) => {
                onKeyDown?.(event);
                if (closeOnEscape && event.key === 'Escape' && !event.defaultPrevented) {
                    event.stopPropagation();
                    onClose(event);
                }
            }}>
            {before}
            <div className="fside-head sticky">
                <h3 id={titleId}>{title}</h3>
                <button className="btn sm" id={closeId} type="button" data-close onClick={onClose}>Close</button>
            </div>
            {(status || kind) && (
                <p className="fside-kind">
                    {status && <span className={'proposal-badge ' + status}>{CHANGE_LABELS[status]}</span>}
                    {kind && <span className="ft">{kind}</span>}
                </p>
            )}
            {children}
        </aside>
    );
}

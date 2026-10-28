import type { ReactNode } from 'react';
import { CHANGE_LABELS } from '../../../../lib/proposal.mjs';
import type { ChangeStatus } from '../../models/types';
import { FlowArrow, FlowShape } from './FlowShape';

export interface ConnectionRowProps {
    /** The connected item's id, as `data-go`. */
    go: string;
    title: ReactNode;
    /** How the connected item is drawn. */
    shape: { type: string; inside?: boolean; inferred?: boolean };
    /** The connected item's own proposed change. */
    status?: ChangeStatus;
    /** The arrow between them; drawn only when it has a label. */
    arrow?: { label?: string; status?: string; inferred?: boolean };
    /** A muted line under the arrow, e.g. "When: signed in". */
    note?: ReactNode;
    /** Outside the trace (e.g. a nearby screen): muted, tagged "nearby". */
    context?: boolean;
    onClick: () => void;
    /** Hover or focus on (true) and off (false). */
    onHover: (on: boolean) => void;
}

/**
 * One connection in a side panel (flowchart step, sitemap screen): the connected item's
 * shape, its change chip and name, then the arrow `── label ──▶` and an optional note.
 */
export function ConnectionRow({ go, title, shape, status, arrow, note, context = false, onClick, onHover }: ConnectionRowProps) {
    return (
        <button className={'cl' + (context ? ' context' : '')} type="button" data-go={go} onClick={onClick}
            onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}
            onFocus={() => onHover(true)} onBlur={() => onHover(false)}>
            <FlowShape type={shape.type} inside={shape.inside} inferred={shape.inferred} />
            <span className="cl-text">
                <span className="cl-title">
                    {status && <span className={'proposal-badge ' + status}>{CHANGE_LABELS[status]}</span>}
                    <b>{title}</b>
                    {context && <em>nearby</em>}
                </span>
                {arrow?.label && <FlowArrow label={arrow.label} status={arrow.status} inferred={arrow.inferred} />}
                {note && <span className="cl-note">{note}</span>}
            </span>
        </button>
    );
}

import type { ReactNode } from 'react';

export interface ModalHeaderProps {
    titleId: string;
    title: ReactNode;
    subtitle?: ReactNode;
    /** Extra buttons shown before Close. */
    actions?: ReactNode;
    /** Optional full-width row under the title and buttons (e.g. a file path). */
    meta?: ReactNode;
    onClose: () => void;
    closeId?: string;
}

/** The standard modal header: one row with the title (two lines at most) and a Close button kept top-right, then an optional `meta` row. Every modal uses it. */
export function ModalHeader({ titleId, title, subtitle, actions, meta, onClose, closeId }: ModalHeaderProps) {
    return (
        <div className={meta ? 'fhead has-meta' : 'fhead'}>
            <div className="fhead-title">
                {/* long titles stop at two lines; the tooltip has the rest */}
                <h2 id={titleId} title={typeof title === 'string' ? title : undefined}>{title}</h2>
                {subtitle && <p>{subtitle}</p>}
            </div>
            <div className="acts">
                {actions}
                <button className="btn" id={closeId} type="button" data-close onClick={onClose}>Close</button>
            </div>
            {meta && <div className="fhead-meta">{meta}</div>}
        </div>
    );
}

import type { ReactNode } from 'react';

export interface ModalHeaderProps {
    titleId: string;
    title: ReactNode;
    subtitle?: ReactNode;
    /** Extra buttons shown before Close. */
    actions?: ReactNode;
    onClose: () => void;
    closeId?: string;
}

/** The standard modal header: one row with the title and a Close button. Every modal uses it. */
export function ModalHeader({ titleId, title, subtitle, actions, onClose, closeId }: ModalHeaderProps) {
    return (
        <div className="fhead">
            <div className="fhead-title">
                <h2 id={titleId}>{title}</h2>
                {subtitle && <p>{subtitle}</p>}
            </div>
            <div className="acts">
                {actions}
                <button className="btn" id={closeId} type="button" data-close onClick={onClose}>Close</button>
            </div>
        </div>
    );
}

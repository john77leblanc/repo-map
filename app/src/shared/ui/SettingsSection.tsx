import type { ReactNode } from 'react';

export interface SettingsSectionProps {
    id: string;
    title: ReactNode;
    open: boolean;
    onToggle: (open: boolean) => void;
    /** Right-aligned badge in the title row, e.g. how many items the section holds. */
    count?: number;
    children: ReactNode;
}

/** A collapsible Settings group: the title row toggles the body. Open state is owned by the view model. */
export function SettingsSection({ id, title, open, onToggle, count, children }: SettingsSectionProps) {
    return (
        <details
            className="settings-section"
            id={id}
            open={open}
            onToggle={(e) => {
                const now = e.currentTarget.open;
                if (now !== open) onToggle(now);
            }}
        >
            <summary>
                <h2 id={id + '-title'}>{title}</h2>
                {count !== undefined && <span className="disclosure-count settings-section-count">{count}</span>}
            </summary>
            <div className="settings-section-body">{children}</div>
        </details>
    );
}

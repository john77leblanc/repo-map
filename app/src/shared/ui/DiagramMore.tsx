import { useEffect, useRef } from 'react';

interface DiagramMoreAction {
    label: string;
    run: () => void;
    disabled?: boolean;
    expanded?: boolean;
    controls?: string;
}

function DiagramMore({ id, open, setOpen, actions }: {
    id: string;
    open: boolean;
    setOpen: (open: boolean) => void;
    actions: DiagramMoreAction[];
}) {
    const root = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!open) return;
        const outside = (event: PointerEvent) => {
            if (!root.current?.contains(event.target as Node)) setOpen(false);
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            trigger.current?.focus();
        };
        document.addEventListener('pointerdown', outside);
        document.addEventListener('keydown', escape, true);
        return () => {
            document.removeEventListener('pointerdown', outside);
            document.removeEventListener('keydown', escape, true);
        };
    }, [open, setOpen]);
    return (
        <div className="diagram-more" ref={root} onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
        }}>
            <button className="btn sm" type="button" ref={trigger} aria-expanded={open} aria-controls={id}
                onClick={() => setOpen(!open)}>More</button>
            <div className="diagram-more-panel" id={id} hidden={!open} role="group" aria-label="More diagram actions">
                {actions.map(action => <button key={action.controls || action.label} className="btn sm" type="button"
                    disabled={action.disabled} aria-expanded={action.expanded} aria-controls={action.controls}
                    onClick={() => {
                        setOpen(false);
                        trigger.current?.focus();
                        action.run();
                    }}>{action.label}</button>)}
            </div>
        </div>
    );
}

export { DiagramMore };

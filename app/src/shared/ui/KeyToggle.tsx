/** Shows or hides a diagram's key: a toggle with a legend icon, filled while the key is open. */
function KeyToggle({ id, controls, open, onToggle }: { id: string; controls: string; open: boolean; onToggle: () => void }) {
    return (
        <button className="btn key-toggle" id={id} type="button" aria-label="Diagram key"
            aria-expanded={open} aria-controls={controls} onClick={onToggle}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M2 4h3M2 8h3M2 12h3" style={{ strokeWidth: 2.4 }} />
                <path d="M7.5 4h6.5M7.5 8h6.5M7.5 12h4.5" />
            </svg>
            Diagram key
        </button>
    );
}

export { KeyToggle };

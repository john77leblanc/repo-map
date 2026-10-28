/**
 * A flowchart arrow in miniature, `── label ──▶`, styled like the chart's: dashed when
 * inferred, coloured by its proposed change. Points right in both connection tabs.
 */
export function FlowArrow({ label, status, inferred = false }: { label: string; status?: string; inferred?: boolean }) {
    const cls = ['fl-arrow', status && 'change-' + status, inferred && 'inf'].filter(Boolean).join(' ');
    return (
        <span className={cls}>
            <span className="fl-arrow-line" aria-hidden="true" />
            <span className="fl-arrow-label">{label}</span>
            <span className="fl-arrow-line fl-arrow-head" aria-hidden="true" />
        </span>
    );
}

/**
 * A flowchart box's shape in miniature, coloured like the box: used in the diagram key
 * and on connection rows. `inside` tints it like a step inside a closer look.
 */
export function FlowShape({ type, inside = false, inferred = false }: { type: string; inside?: boolean; inferred?: boolean }) {
    const cls = (extra = '') => ['lg', extra, inside && 'xp', inferred && 'inf'].filter(Boolean).join(' ');
    return (
        <svg className="fshape" viewBox="0 0 22 14" aria-hidden="true">
            {type === 'start' || type === 'end' ? <rect className={cls('se')} x="1" y="2" width="20" height="10" rx="5" />
                : type === 'action' ? <polygon className={cls('act')} points="5,2 21,2 17,12 1,12" />
                : type === 'decision' ? <polygon className={cls('dec')} points="11,0 22,7 11,14 0,7" />
                : type === 'error' ? <rect className={cls('err')} x="1" y="2" width="20" height="10" rx="2" />
                : type === 'collapsed' ? <>
                    <rect className={cls()} x="5" y="1" width="16" height="9" rx="2" />
                    <rect className={cls()} x="1" y="4" width="16" height="9" rx="2" />
                </>
                : <rect className={cls()} x="1" y="2" width="20" height="10" rx="2" />}
        </svg>
    );
}

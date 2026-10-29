/** A trace step's number, the same small ink pill everywhere (sidebar steps, map cards, step card). */
function StepNumber({ n, className }: { n: number; className?: string }) {
    return <span className={'step-number' + (className ? ' ' + className : '')} aria-hidden="true">{n}</span>;
}

export { StepNumber };

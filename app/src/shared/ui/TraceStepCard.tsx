import type { ReactNode } from 'react';
import { StepNumber } from './StepNumber';

export interface TraceStepCardProps {
    /** Prefix for the Prev / Next button ids (`<prefix>-step-prev`). */
    idPrefix: string;
    /** Zero-based step index. */
    index: number;
    total: number;
    note: string;
    hasPrev: boolean;
    hasNext: boolean;
    onPrev: () => void;
    onNext: () => void;
    /** The step's code references. */
    children?: ReactNode;
}

/** A side panel's trace step: "Trace step 2 of 5", its note and code, with ‹ Prev | Next › through the trace. */
export function TraceStepCard({ idPrefix, index, total, note, hasPrev, hasNext, onPrev, onNext, children }: TraceStepCardProps) {
    return (
        <section className="arch-step trace-step" aria-label="Trace step">
            <h3>
                <StepNumber n={index + 1} className="arch-step-number" />
                <span>Trace step <span className="arch-step-of">{index + 1} of {total}</span></span>
                <span className="arch-step-nav">
                    <button className="link" type="button" id={idPrefix + '-step-prev'} aria-label="Previous trace step"
                        disabled={!hasPrev} onClick={onPrev}>‹ Prev</button>
                    <span aria-hidden="true">|</span>
                    <button className="link" type="button" id={idPrefix + '-step-next'} aria-label="Next trace step"
                        disabled={!hasNext} onClick={onNext}>Next ›</button>
                </span>
            </h3>
            <p>{note}</p>
            {children}
        </section>
    );
}

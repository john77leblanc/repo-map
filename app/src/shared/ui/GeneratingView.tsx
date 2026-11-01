import type { ProgressEntry } from '../../models/ProgressLog';
import { ProgressLine } from './ProgressLine';

interface GeneratingViewProps {
    /** e.g. "Generating the sitemap…" */
    title: string;
    /** The latest progress line. */
    text: string;
    entries: ProgressEntry[];
    onStop?: () => void;
}

/** Shown in the diagram area instead of a view while it is generated; the diagram returns when the job ends. */
function GeneratingView({ title, text, entries, onStop }: GeneratingViewProps) {
    return (
        <section className="view-missing view-generating" id="view-generating" aria-busy="true" aria-labelledby="view-generating-title">
            <span className="view-spinner" aria-hidden="true" />
            <h2 id="view-generating-title">{title}</h2>
            <ProgressLine id="view-generating-status" text={text || 'Starting…'} entries={entries} busy />
            {onStop && <button className="btn" type="button" id="view-generating-stop" onClick={onStop}>Stop</button>}
        </section>
    );
}

export { GeneratingView };

import type { ReactNode } from 'react';
import type { ProgressEntry } from '../../models/ProgressLog';
import { ProgressLine } from './ProgressLine';

interface ViewJobRowProps {
    /** Id prefix: the row is `<id>-row`, its heading `<id>-title`. */
    id: string;
    title: string;
    /** What the view is like now (freshness, "Not generated"…), or an error. */
    status?: ReactNode;
    error?: boolean;
    /** The row's buttons. */
    children?: ReactNode;
    /** While its job runs: the progress line and Stop. */
    job?: { text: string; entries: ProgressEntry[]; busy: boolean; error?: boolean; onStop?: () => void; statusId?: string; stopId?: string };
}

/** One view in a Views list (Settings → Map, a trace's sidebar): its state, its buttons, and its job's progress. */
function ViewJobRow({ id, title, status, error, children, job }: ViewJobRowProps) {
    return (
        <section className="view-row" id={id + '-row'} aria-labelledby={id + '-title'}>
            <h4 id={id + '-title'}>{title}</h4>
            {status && <div className={'hint view-row-status' + (error ? ' err' : '')}>{status}</div>}
            {children && <div className="row view-row-actions">{children}</div>}
            {job && (job.busy || job.text) && (
                <div className="row view-row-job">
                    <ProgressLine id={job.statusId} text={job.text} entries={job.entries} busy={job.busy} error={job.error} />
                    {job.onStop && (
                        <button className="btn sm" id={job.stopId} type="button" hidden={!job.busy} onClick={job.onStop}>Stop</button>
                    )}
                </div>
            )}
        </section>
    );
}

export { ViewJobRow };
export type { ViewJobRowProps };

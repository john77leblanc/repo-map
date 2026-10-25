import { observer } from 'mobx-react-lite';
import type { ProgressEntry } from '../../models/ProgressLog';

export interface ProgressLineProps {
    /** Goes on the status text (the current line), not the wrapper. */
    id?: string;
    /** The line shown when collapsed; defaults to the latest entry. */
    text?: string;
    entries: ProgressEntry[];
    busy?: boolean;
    error?: boolean;
    className?: string;
}
const seconds = (ms: number) => '+' + Math.round(ms / 1000) + 's';

/**
 * One truncated status line. With more than one progress message it becomes a
 * disclosure that lists every message with the seconds elapsed.
 */
export const ProgressLine = observer(function ProgressLine({ id, text, entries, busy, error, className = '' }: ProgressLineProps) {
    const line = text ?? (entries.length ? entries[entries.length - 1].text : '');
    const cls = ['progress-line', 'status', busy ? 'busy' : '', error ? 'err' : '', className].filter(Boolean).join(' ');
    const summary = <span className="progress-text" id={id} role="status" aria-live="polite" title={line}>{line}</span>;
    if (entries.length < 2) return <div className={cls}>{summary}</div>;
    return (
        <details className={cls}>
            <summary aria-label={'Progress: ' + line + '. Show history'}>{summary}</summary>
            <ol className="progress-history" aria-label="Progress history">
                {entries.map((e, i) => (
                    <li key={i}><time>{seconds(e.at)}</time><span>{e.text}</span></li>
                ))}
            </ol>
        </details>
    );
});

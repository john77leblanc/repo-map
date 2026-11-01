import type { ReactNode } from 'react';
import type { ProgressEntry } from '../../models/ProgressLog';
import { ProgressLine } from './ProgressLine';
import { KeyToggle } from './KeyToggle';
import { ExportMenu } from './ExportMenu';

interface DiagramToolbarProps {
    prefix: string;
    label: string;
    available: boolean;
    selectors?: ReactNode;
    /** Diagram-specific controls after zoom and the key (e.g. Select steps). */
    tools?: ReactNode;
    extraActions?: ReactNode;
    diagramKey: { id: string; open: boolean; toggle: () => void };
    status: string;
    /** Job progress history; when the status is its latest line, the status expands into it. */
    log?: ProgressEntry[];
    busy: boolean;
    loading?: boolean;
    error: boolean;
    copied: boolean;
    onZoom: (factor: number) => void;
    onFit: () => void;
    onCopy: () => void;
    onDownload: (resolve: (variable: string) => string) => void;
    onStop: () => void;
    /** False hides Stop while busy, for a job stopped from elsewhere (e.g. a side panel). */
    stoppable?: boolean;
    /** The view's Search button, last on the right. */
    search?: ReactNode;
}

function DiagramToolbar({ prefix, label, available, selectors, tools, extraActions, diagramKey,
    status, log, busy, loading, error, copied, onZoom, onFit, onCopy, onDownload, onStop, stoppable = true, search }: DiagramToolbarProps) {
    return (
        <div className="diagram-toolbar flow-tools">
            <div className="flow-zoom" role="group" aria-label={label + ' controls'}>
                {selectors}
                <button className="btn" id={prefix + '-out'} type="button" aria-label="Zoom out" disabled={!available} onClick={() => onZoom(1 / 1.2)}>-</button>
                <button className="btn" id={prefix + '-fit'} type="button" disabled={!available} onClick={onFit}>Fit</button>
                <button className="btn" id={prefix + '-in'} type="button" aria-label="Zoom in" disabled={!available} onClick={() => onZoom(1.2)}>+</button>
                <KeyToggle id={diagramKey.id + '-toggle'} controls={diagramKey.id} open={diagramKey.open} onToggle={diagramKey.toggle} />
                {tools}
            </div>
            <div className="flow-actions">
                {log && log.length > 1 && status === log[log.length - 1].text
                    ? <ProgressLine id={prefix + '-status'} text={status} entries={log} busy={busy || loading} error={error} />
                    : <span className={'status' + (busy || loading ? ' busy' : error ? ' err' : '')}
                        id={prefix + '-status'} role="status" aria-live="polite">{status}</span>}
                <ExportMenu prefix={prefix} available={available} copied={copied} onCopy={onCopy} onDownload={() => {
                    const style = getComputedStyle(document.documentElement);
                    onDownload(variable => style.getPropertyValue(variable).trim());
                }} />
                {extraActions}
                <button className="btn sm" id={prefix + '-stop'} type="button" hidden={!busy || !stoppable} onClick={onStop}>Stop</button>
                {search}
            </div>
        </div>
    );
}

export { DiagramToolbar };
export type { DiagramToolbarProps };

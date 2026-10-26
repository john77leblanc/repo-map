import type { ReactNode } from 'react';
import type { ProgressEntry } from '../../models/ProgressLog';
import { ProgressLine } from './ProgressLine';
import { KeyToggle } from './KeyToggle';

interface DiagramToolbarProps {
    prefix: string;
    label: string;
    available: boolean;
    selectors?: ReactNode;
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
    generation: { label: string; title: string; hidden?: boolean; disabled?: boolean; run: () => void };
}

function DiagramToolbar({ prefix, label, available, selectors, extraActions, diagramKey,
    status, log, busy, loading, error, copied, onZoom, onFit, onCopy, onDownload, onStop, generation }: DiagramToolbarProps) {
    return (
        <div className="diagram-toolbar flow-tools">
            <div className="flow-zoom" role="group" aria-label={label + ' controls'}>
                {selectors}
                <button className="btn" id={prefix + '-out'} type="button" aria-label="Zoom out" disabled={!available} onClick={() => onZoom(1 / 1.2)}>-</button>
                <button className="btn" id={prefix + '-fit'} type="button" disabled={!available} onClick={onFit}>Fit</button>
                <button className="btn" id={prefix + '-in'} type="button" aria-label="Zoom in" disabled={!available} onClick={() => onZoom(1.2)}>+</button>
                <KeyToggle id={diagramKey.id + '-toggle'} controls={diagramKey.id} open={diagramKey.open} onToggle={diagramKey.toggle} />
            </div>
            <div className="flow-actions">
                {log && log.length > 1 && status === log[log.length - 1].text
                    ? <ProgressLine id={prefix + '-status'} text={status} entries={log} busy={busy || loading} error={error} />
                    : <span className={'status' + (busy || loading ? ' busy' : error ? ' err' : '')}
                        id={prefix + '-status'} role="status" aria-live="polite">{status}</span>}
                <button className="btn sm" id={prefix + '-mermaid'} type="button"
                    title="Mermaid source, for GitHub, GitLab, Notion and other Markdown tools"
                    disabled={!available} onClick={onCopy}>{copied ? 'Copied' : 'Copy Mermaid'}</button>
                <button className="btn sm" id={prefix + '-svg'} type="button" disabled={!available} onClick={() => {
                    const style = getComputedStyle(document.documentElement);
                    onDownload(variable => style.getPropertyValue(variable).trim());
                }}>Download SVG</button>
                {extraActions}
                <button className="btn sm" id={prefix + '-stop'} type="button" hidden={!busy} onClick={onStop}>Stop</button>
                <button className="btn sm" id={prefix + '-redraw'} type="button" title={generation.title}
                    hidden={generation.hidden} disabled={busy || generation.disabled} onClick={generation.run}>{generation.label}</button>
            </div>
        </div>
    );
}

export { DiagramToolbar };
export type { DiagramToolbarProps };

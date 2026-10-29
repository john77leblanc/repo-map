import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import type { ReferenceViewerModel } from '../../models/ReferenceViewerModel';
import { ModalHeader } from './ModalHeader';
import { trimPath } from './trimPath';

/**
 * A path on one line: leading folders give way to `.../` until it fits.
 * Re-fits when the modal header changes width.
 */
function FittedPath({ path, suffix }: { path: string; suffix: string }) {
    const code = useRef<HTMLElement>(null);
    const [keep, setKeep] = useState(Infinity);
    const segments = path.split('/').length;
    useLayoutEffect(() => setKeep(Infinity), [path, suffix]);
    // Drop one more folder per pass until the line fits (runs before paint).
    useLayoutEffect(() => {
        const el = code.current;
        if (el && el.scrollWidth > el.clientWidth && Math.min(keep, segments) > 1) setKeep(Math.min(keep, segments) - 1);
    });
    useEffect(() => {
        const head = code.current?.closest('.fhead');
        if (!head || typeof ResizeObserver === 'undefined') return;
        let width = head.clientWidth;
        const observer = new ResizeObserver(() => {
            if (head.clientWidth === width) return;
            width = head.clientWidth;
            setKeep(Infinity);
        });
        observer.observe(head);
        return () => observer.disconnect();
    }, []);
    return <code ref={code}>{trimPath(path, keep)}{suffix}</code>;
}

/** How one unified-diff line is drawn: hunk header, file header, added or removed. */
function diffClass(line: string) {
    if (line.startsWith('@@')) return 'dh';
    if (/^(diff |index |--- |\+\+\+ |new file|deleted file|similarity|rename )/.test(line)) return 'dm';
    if (line.startsWith('+')) return 'da';
    if (line.startsWith('-')) return 'dd';
    return '';
}

/** The code reference modal: the cited lines with a little context, Copy path, GitHub and Prev/Next. */
export const ReferenceModal = observer(function ReferenceModal({ vm }: { vm: ReferenceViewerModel }) {
    const dialog = useRef<HTMLDialogElement>(null);
    const body = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (vm.isOpen && !dialog.current?.open) dialog.current?.showModal?.();
        else if (!vm.isOpen && dialog.current?.open) dialog.current.close();
    }, [vm.isOpen]);
    // Bring the cited lines into view once they're read.
    useEffect(() => {
        body.current?.querySelector('.cl2.cited')?.scrollIntoView?.({ block: 'nearest' });
    }, [vm.content]);
    const r = vm.current;
    const content = vm.content;
    return (
        <dialog ref={dialog} id="ref-dialog" className="modal ref-modal" aria-labelledby="ref-title"
            onClose={vm.close} onCancel={vm.close}>
            {r && <>
                <ModalHeader titleId="ref-title" closeId="ref-close" onClose={vm.close}
                    title={(vm.isDocument && r.title) || r.path.split('/').pop()}
                    actions={<>
                        {/* The path copies itself; its tooltip says so, then confirms. */}
                        <button className={'ref-path' + (vm.copy.copied ? ' copied' : '')} id="ref-copy" type="button"
                            data-tip={vm.copy.copied ? 'Copied!' : 'Copy path'}
                            aria-label={(vm.copy.copied ? 'Copied: ' : 'Copy path: ') + `${r.path}#L${r.start}-L${r.end}`}
                            onClick={() => void vm.copyPath()}>
                            <FittedPath path={r.path} suffix={vm.isDiff ? '' : `#L${r.start}-L${r.end}`} />
                        </button>
                        {vm.href && (
                            <a className="btn" id="ref-github" href={vm.href} target="_blank" rel="noopener"
                                title={vm.exact ? 'Open on GitHub' : 'Open on GitHub (lines may differ from your checkout)'}>
                                GitHub ↗
                            </a>
                        )}
                    </>} />
                <div className="modal-body" ref={body}>
                    {r.why && <p className="ref-why">{r.why}</p>}
                    <div className="code" role="region" aria-label={r.path} tabIndex={0}>
                        {vm.loading ? <p className="ref-note">Loading…</p>
                            : vm.error ? <p className="ref-note err">{vm.error}{' '}
                                <button className="btn sm" type="button" onClick={vm.retry}>Retry</button></p>
                            : content?.diff ? (content.lines.length ? content.lines.map((line, i) => (
                                <div className={'cl2 diff ' + diffClass(line)} key={i}>
                                    <span className="lc">{line || ' '}</span>
                                </div>
                            )) : <p className="ref-note">No changes in this file.</p>)
                            : content?.lines.map((line, i) => {
                                const n = content.start + i;
                                return (
                                    <div className={'cl2' + (vm.cited(n) ? ' cited' : '')} key={n}>
                                        <span className="ln">{n}</span>
                                        <span className="lc">{line || ' '}</span>
                                    </div>
                                );
                            })}
                        {content?.diff && (content.total || 0) > content.lines.length && (
                            <div className="more">… {content.total! - content.lines.length} more lines of changes</div>
                        )}
                        {content && !content.diff && r.end > content.end && content.end < (content.total || 0) && (
                            <div className="more">
                                … {Math.min(r.end, content.total!) - content.end} more lines in the file
                            </div>
                        )}
                    </div>
                </div>
                {vm.list.length > 1 && (
                    <nav className="ref-nav" aria-label="References">
                        <button className="btn sm" id="ref-prev" type="button" disabled={!vm.hasPrev} onClick={vm.prev}>‹ Prev</button>
                        <span>{vm.index + 1} of {vm.list.length}</span>
                        <button className="btn sm" id="ref-next" type="button" disabled={!vm.hasNext} onClick={vm.next}>Next ›</button>
                    </nav>
                )}
            </>}
        </dialog>
    );
});

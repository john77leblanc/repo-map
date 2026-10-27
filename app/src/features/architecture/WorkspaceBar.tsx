import { observer } from 'mobx-react-lite';
import { freshnessBadges } from '../../models/WorkspaceModel';
import { CodeReference } from '../../shared/ui/CodeReference';
import { ProgressLine } from '../../shared/ui/ProgressLine';
import type { ArchitectureViewModel } from './ArchitectureViewModel';

/** Switch between this repo's map and the workspace (every linked repo in one map). `disabled` on views it doesn't affect; locked while a workspace trace is open. */
export const ScopeSwitch = observer(function ScopeSwitch({ vm, disabled = false }: { vm: ArchitectureViewModel; disabled?: boolean }) {
    if (!vm.workspace?.linked) return null;
    const title = disabled ? 'Applies to the Architecture view' : vm.scopeLocked ? 'This trace spans linked repos' : undefined;
    disabled ||= vm.scopeLocked;
    return (
        <div className="seg" role="group" aria-label="Map scope" aria-disabled={disabled || undefined} title={title}>
            <button className="btn" id="arch-scope-repo" type="button" disabled={disabled} aria-pressed={vm.scope === 'repo'} onClick={() => vm.setScope('repo')}>
                This repo
            </button>
            <button className="btn" id="arch-scope-ws" type="button" disabled={disabled} aria-pressed={vm.scope === 'workspace'} onClick={() => vm.setScope('workspace')}>
                Workspace
            </button>
        </div>
    );
});

/** Workspace view controls: each repo's freshness and fold, and the seam finder. */
export const WorkspaceBar = observer(function WorkspaceBar({ vm }: { vm: ArchitectureViewModel }) {
    const ws = vm.workspace;
    if (!ws || vm.scope !== 'workspace') return null;
    const seams = ws.view?.map.seams.length || 0;
    return (
        <section className="ws-bar" id="workspace-bar" aria-label="Workspace">
            <div className="ws-row">
                <ul className="ws-repos">
                    {ws.activeRepos.map((r) => (
                        <li key={r.name} data-repo={r.name}>
                            <b>{r.title}</b>
                            {freshnessBadges(r).map((b) => (
                                <span key={b.text} className={'fresh ' + b.tone} title={b.title}>{b.text}</span>
                            ))}
                            {!r.error && (
                                <button className="btn sm" type="button" data-repo-fold={r.name} aria-pressed={vm.isRepoCollapsed(r.name)}
                                    onClick={() => vm.toggleRepo(r.name)}>
                                    {vm.isRepoCollapsed(r.name) ? 'Expand' : 'Collapse'}
                                </button>
                            )}
                            {!r.error && (r.source !== 'snapshot' || r.snapshot?.remote) && (
                                <button className="btn sm" type="button" data-repo-refresh={r.name} disabled={!!ws.refreshing[r.name]}
                                    title={r.source === 'snapshot' ? 'Compare the snapshot with its remote' : 'git fetch, then compare with the default branch'}
                                    onClick={() => void ws.refresh(r.name)}>
                                    {ws.refreshing[r.name] ? 'Refreshing…' : 'Refresh'}
                                </button>
                            )}
                            {ws.repoErrors[r.name] && <span className="status err">{ws.repoErrors[r.name]}</span>}
                        </li>
                    ))}
                </ul>
                <div className="ws-seams">
                    <span className="ws-seams-count" id="ws-seam-count">
                        {seams} seam{seams === 1 ? '' : 's'}
                    </span>
                    <button className="btn sm" type="button" id="ws-find-seams" hidden={ws.seamBusy} disabled={!vm.repo.aiAvailable}
                        title={vm.repo.aiAvailable ? 'Ask the map’s AI tool for connections contracts didn’t find' : 'Set up an AI tool in Settings first'}
                        onClick={() => void ws.findSeams()}>
                        Find seams
                    </button>
                    <button className="btn sm" type="button" hidden={!ws.seamBusy} onClick={ws.stopSeams}>Stop</button>
                </div>
            </div>
            {!!ws.seamLog.entries.length && (
                <ProgressLine id="ws-seam-status" entries={ws.seamLog.entries} busy={ws.seamBusy} error={ws.seamError} />
            )}
            {!!ws.proposals.length && (
                <ul className="ws-proposals" id="ws-proposals" aria-label="Suggested connections">
                    {ws.proposals.map((s) => (
                        <li key={s.from + '>' + s.to} data-seam={s.from + '>' + s.to}>
                            <p>
                                <b>{vm.nodeTitle(s.from)}</b> → <b>{vm.nodeTitle(s.to)}</b>
                                {s.label && <span className="hint"> · {s.label}</span>}
                            </p>
                            {s.why && <p className="hint">{s.why}</p>}
                            <details>
                                <summary>Evidence ({s.refs?.length || 0})</summary>
                                {s.refs?.map((r, i) => <CodeReference key={r.path + i} reference={r} repo={vm.repo} />)}
                            </details>
                            <button className="btn sm" type="button" data-accept onClick={() => void ws.acceptSeam(s)} disabled={ws.saving}>
                                Accept
                            </button>
                            <button className="btn sm" type="button" data-dismiss onClick={() => ws.dismissSeam(s)}>
                                Dismiss
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
});

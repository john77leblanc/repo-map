import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { freshnessBadges, type WorkspaceModel } from '../../models/WorkspaceModel';
import { validLinkName } from '../../../../lib/workspace-map.mjs';

/** Settings → Linked repos body: other repos whose maps join this one in the workspace view. */
export const LinkedRepos = observer(function LinkedRepos({ model }: { model: WorkspaceModel }) {
    const [name, setName] = useState('');
    const [dir, setDir] = useState('');
    const [snapName, setSnapName] = useState('');
    const linked = model.repos.filter((r) => r.name !== 'home');
    const nameOk = validLinkName(name) && !linked.some((r) => r.name === name);
    const snapOk = validLinkName(snapName);
    return (
        <div className="linked-repos">
            <p className="hint">
                Maps of other repos to show beside this one, joined where one calls another. Saved for the team in{' '}
                <code>.repo-map/workspace.json</code>. A folder is read live; a snapshot (from <code>repo-map export</code>) is a copy of
                a map whose code isn’t on this machine.
            </p>
            {linked.length ? (
                <ul className="link-list">
                    {linked.map((r) => (
                        <li key={r.name} data-link={r.name}>
                            <b>{r.title}</b> <code>{r.name}</code>{' '}
                            <span className="hint">{r.source === 'dir' ? r.dir : 'snapshot'}</span>{' '}
                            {freshnessBadges(r).map((b) => (
                                <span key={b.text} className={'fresh ' + b.tone} title={b.title}>{b.text}</span>
                            ))}
                            <button className="btn sm" type="button" disabled={model.saving} onClick={() => void model.removeLink(r.name)}>
                                Remove
                            </button>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="hint" id="links-empty">No repos linked yet.</p>
            )}
            <form
                className="link-form"
                id="link-add"
                onSubmit={(e) => {
                    e.preventDefault();
                    if (nameOk && dir.trim())
                        void model.addLink(name, dir).then((ok) => {
                            if (ok) {
                                setName('');
                                setDir('');
                            }
                        });
                }}
            >
                <label>
                    Name
                    <input id="link-name" value={name} placeholder="api" aria-describedby="link-name-hint"
                        onChange={(e) => setName(e.target.value.toLowerCase())} />
                </label>
                <label>
                    Folder
                    <input id="link-dir" value={dir} placeholder="../shop-api" onChange={(e) => setDir(e.target.value)} />
                </label>
                <button className="btn sm" type="submit" disabled={!nameOk || !dir.trim() || model.saving}>
                    Link folder
                </button>
            </form>
            <p className="hint" id="link-name-hint">
                Names are short ids such as <code>api</code>: lowercase letters, digits and dashes. They prefix the linked repo’s cards
                (<code>api:orders-route</code>). Folders are relative to this repo.
            </p>
            <div className="link-form">
                <label>
                    Snapshot name
                    <input id="snap-name" value={snapName} placeholder="payments" onChange={(e) => setSnapName(e.target.value.toLowerCase())} />
                </label>
                <label className="btn sm file-btn" aria-disabled={!snapOk || model.saving}>
                    Import snapshot…
                    <input
                        id="snap-file"
                        type="file"
                        accept=".json,application/json"
                        disabled={!snapOk || model.saving}
                        onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = '';
                            if (file)
                                void file.text().then((text) => model.importSnapshot(snapName, text)).then((ok) => {
                                    if (ok) setSnapName('');
                                });
                        }}
                    />
                </label>
            </div>
            {model.error && (
                <p className="status err" role="status" id="links-error">
                    {model.error}
                </p>
            )}
        </div>
    );
});

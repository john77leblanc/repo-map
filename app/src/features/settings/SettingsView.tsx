import { observer } from 'mobx-react-lite';
import { useEffect, useRef } from 'react';
import { AgentPicker } from '../../shared/ui/AgentPicker';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { ProgressLine } from '../../shared/ui/ProgressLine';
import { SettingsSection } from '../../shared/ui/SettingsSection';
import type { SettingsSectionId, SettingsViewModel } from './SettingsViewModel';
import { LinkedRepos } from './LinkedRepos';

const SECTION_IDS: Record<SettingsSectionId, string> = {
    map: 'settings-map',
    agents: 'settings-agents',
    links: 'linked-repos',
};

export interface SettingsViewProps {
    vm: SettingsViewModel;
    open: boolean;
    onClose: () => void;
}
export const SettingsView = observer(function SettingsView({
    vm,
    open,
    onClose,
}: SettingsViewProps) {
    const dialog = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        const d = dialog.current;
        if (!d) return;
        if (open && !d.open) d.showModal();
        else if (!open && d.open) d.close();
    }, [open]);
    // After showModal, so the section is laid out and keeps focus.
    const revealed = vm.revealed;
    useEffect(() => {
        if (!open || !revealed) return;
        const el = dialog.current?.querySelector<HTMLElement>('#' + SECTION_IDS[revealed]);
        el?.scrollIntoView?.({ block: 'start' });
        el?.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true });
        vm.clearRevealed();
    }, [open, revealed, vm]);
    return (
        <dialog
            ref={dialog}
            id="settings-dialog"
            className="modal"
            aria-labelledby="settings-title"
            onCancel={onClose}
            onClose={onClose}
        >
            <ModalHeader titleId="settings-title" title="Settings" closeId="settings-close" onClose={onClose} />
            <div className="modal-body">
                <SettingsPanel vm={vm} />
            </div>
        </dialog>
    );
});
export const SettingsPanel = observer(function SettingsPanel({ vm }: { vm: SettingsViewModel }) {
    const st = vm.mapStatus,
        d = st?.docs || {},
        sha = st?.commit?.slice(0, 9),
        n = (v: number, word: string) => `${v} ${word}${v === 1 ? '' : 's'}`;
    const freshness = !st
        ? 'Checking…'
        : {
              current: (
                  <>
                      Up to date with the code
                      {sha && (
                          <>
                              {' '}
                              at <code>{sha}</code>
                          </>
                      )}
                      .
                  </>
              ),
              stale: (
                  <>
                      <b>Out of date.</b> {n(st.changed || 0, 'file')} in the code folders changed
                      since it was evaluated at <code>{sha}</code>
                      {st.commitsSince ? ` (${n(st.commitsSince, 'commit')} ago)` : ''}.
                  </>
              ),
              unrecorded:
                  'This map has no recorded commit, so repo-map can’t tell when it goes out of date.',
              unknown: (st.reason || '') + ' Redraw it to start tracking again.',
              starter:
                  'This is a starter map built from your folders. Draw the full map to see how the code fits together.',
              empty: 'There is no map yet.',
              nogit: 'This folder isn’t a git repository, so changes can’t be tracked.',
          }[st.state] || '';
    const docs = !vm.hasMap
        ? ''
        : !d.linked
          ? 'Documentation isn’t linked to the cards yet.'
          : d.changed
            ? `${n(d.changed, 'document')} changed since the docs were linked: ${(d.files || []).slice(0, 4).join(', ')}${d.changed > 4 ? ', …' : ''}.`
            : 'Docs linked to the cards' +
              (d.generatedAt
                  ? ' on ' +
                    new Date(d.generatedAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                    })
                  : '') +
              '.';
    const common = {
        agents: vm.data?.agents || [],
        loading: vm.loading,
        onRefresh: () => {
            void vm.loadCatalog(true);
        },
    };
    const section = (id: SettingsSectionId) => ({
        id: SECTION_IDS[id],
        open: vm.isOpen(id),
        onToggle: (open: boolean) => vm.setOpen(id, open),
    });
    return (
        <div className="pane" id="pane-map">
            <SettingsSection title="Map" {...section('map')}>
                <p className="repository-details">
                    <code id="repo-name">{vm.repositoryDetails.name}</code>
                    <span id="stat">{vm.repositoryDetails.counts}</span>
                    <span id="repoinfo">{vm.repositoryDetails.revision}</span>
                </p>
                <div>
                    <p className="hint" id="ms-text">
                        {freshness}
                    </p>
                    <p
                        className="mfiles"
                        id="ms-files"
                        hidden={st?.state !== 'stale' || !st.files?.length}
                    >
                        {st?.files?.slice(0, 12).join('  ·  ')}
                        {(st?.changed || 0) > 12 ? '  · …' : ''}
                    </p>
                    <p className="hint" id="ms-docs">
                        {docs}
                    </p>
                    <div className="row">
                        <button
                            className="btn sm primary"
                            id="ms-update"
                            type="button"
                            hidden={st?.state !== 'stale'}
                            disabled={vm.jobsDisabled || !!st?.tooBig}
                            title={
                                st?.tooBig
                                    ? 'Too many changes for a quick update: redraw the map instead.'
                                    : vm.noAi || ''
                            }
                            onClick={() => void vm.runJob('update')}
                        >
                            Update map
                        </button>
                        <button
                            className="btn sm"
                            id="ms-mark"
                            type="button"
                            hidden={st?.state !== 'unrecorded'}
                            disabled={vm.busy || vm.serverBusy}
                            onClick={() => void vm.markCurrent()}
                        >
                            Mark as current
                        </button>
                        <button
                            className="btn sm"
                            id="ms-redraw"
                            type="button"
                            disabled={vm.jobsDisabled}
                            title={
                                vm.noAi ||
                                'Explore the whole repo again and replace map.json. The current map is kept as .repo-map/map.prev.json. Takes several minutes.'
                            }
                            onClick={vm.redraw}
                        >
                            {vm.redrawArmed
                                ? 'Confirm redraw'
                                : vm.hasMap
                                  ? 'Redraw map'
                                  : 'Draw the full map'}
                        </button>
                        <button
                            className="btn sm"
                            id="ms-docs-go"
                            type="button"
                            hidden={!vm.hasMap}
                            disabled={vm.jobsDisabled}
                            title={
                                vm.noAi ||
                                "Read the repo's documentation, agent guidance and code comments again, and link them to the cards (.repo-map/docs.json)."
                            }
                            onClick={() => void vm.runJob('docs')}
                        >
                            {d.linked ? 'Relink docs' : 'Link docs'}
                        </button>
                        <button
                            className="btn sm"
                            id="ms-dismiss"
                            type="button"
                            hidden={!vm.notice}
                            onClick={vm.dismissNotice}
                        >
                            Dismiss notification
                        </button>
                    </div>
                    <div className="row">
                        <ProgressLine
                            id="job-status"
                            text={vm.jobStatus}
                            entries={vm.busy || (vm.jobLog.last && vm.jobStatus.startsWith(vm.jobLog.last)) ? vm.jobLog.entries : []}
                            busy={vm.busy}
                            error={vm.jobError}
                        />
                        <button
                            className="btn sm"
                            id="job-stop"
                            type="button"
                            hidden={!vm.busy}
                            onClick={vm.stopJob}
                        >
                            Stop
                        </button>
                    </div>
                </div>
            </SettingsSection>
            <SettingsSection title="Agents" {...section('agents')}>
                <section aria-labelledby="map-agent-title">
                    <h3 id="map-agent-title">Map agent</h3>
                    <p className="hint">
                        The AI tool, model and effort that draw and update the map, link its
                        documentation, and generate the sitemap. Saved for you in this repo (<code>.repo-map/local.json</code>).
                    </p>
                    <AgentPicker
                        {...common}
                        prefix="mpick"
                        label="AI tool and model for the map"
                        value={vm.mapPick}
                        onChange={vm.setMapPick}
                        inheritLabel={
                            'Same as traces' +
                            (vm.data?.default ? ' · ' + vm.choiceLabel(vm.data.default) : '')
                        }
                    />
                    <p
                        className={'status' + (vm.saving ? ' busy' : vm.saveError ? ' err' : '')}
                        id="mpick-status"
                        aria-live="polite"
                    >
                        {vm.saveStatus}
                    </p>
                </section>
                <section aria-labelledby="trace-agent-title">
                    <h3 id="trace-agent-title">Trace agent</h3>
                    <p className="hint">
                        The tool, model and effort for architecture traces and flowcharts. Remembered in
                        this browser for this repository. Used for new traces and flowchart redraws.
                    </p>
                    <AgentPicker
                        {...common}
                        prefix="tpick"
                        label="AI tool and model for traces"
                        value={vm.tracePick}
                        onChange={vm.setTracePick}
                        hidden={!vm.available}
                    />
                    <div className="row" hidden={!vm.available}>
                        <button
                            className="btn sm"
                            id="tpick-default"
                            type="button"
                            disabled={vm.savingDefault || !vm.currentPick().agent}
                            title="Save this choice as your default trace tool in every repo (~/.config/repo-map/ai.json)."
                            onClick={() => void vm.useTraceEverywhere()}
                        >
                            Use in every repo
                        </button>
                        <p
                            className={'status' + (vm.savingDefault ? ' busy' : vm.traceDefaultError ? ' err' : '')}
                            id="tpick-default-status"
                            aria-live="polite"
                        >
                            {vm.traceDefaultStatus}
                        </p>
                    </div>
                    {vm.catalogError && (
                        <p className="status err" role="status">
                            {vm.catalogError}
                        </p>
                    )}
                </section>
            </SettingsSection>
            {vm.deps.workspace && (
                <SettingsSection title="Linked repos" {...section('links')}>
                    <LinkedRepos model={vm.deps.workspace} />
                </SettingsSection>
            )}
        </div>
    );
});

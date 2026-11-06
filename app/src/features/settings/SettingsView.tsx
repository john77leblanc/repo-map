import { Observer, observer } from 'mobx-react-lite';
import { useEffect, useRef } from 'react';
import { AgentPicker } from '../../shared/ui/AgentPicker';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { ProgressLine } from '../../shared/ui/ProgressLine';
import { Tabs, type TabItem } from '../../shared/ui/Tabs';
import type { SettingsSectionId, SettingsViewModel } from './SettingsViewModel';
import { LinkedRepos } from './LinkedRepos';
import { ViewJobRow } from '../../shared/ui/ViewJobRow';
import type { ProgressEntry } from '../../models/ProgressLog';

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
    // After showModal, so the tab is laid out and keeps focus.
    const revealed = vm.revealed;
    useEffect(() => {
        if (!open || !revealed) return;
        dialog.current?.querySelector<HTMLElement>(`#settings-${revealed}-tab`)?.focus({ preventScroll: true });
        dialog.current?.querySelector('.modal-body')?.scrollTo?.({ top: 0 });
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
            {/* the tabs stay put; the tab panel is the .modal-body that scrolls */}
            <SettingsPanel vm={vm} />
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
    const tabs: TabItem<SettingsSectionId>[] = [
        { id: 'map', label: 'Map' },
        { id: 'agents', label: 'Agents' },
        ...(vm.deps.workspace ? [{ id: 'links' as const, label: 'Linked repos' }] : []),
    ];
    return (
        <div className="pane" id="pane-map">
            <Tabs idPrefix="settings" label="Settings" className="settings-tabs" panelClassName="modal-body settings-panel" tabs={tabs} active={vm.activeTab} onChange={vm.setTab}>
                {/* Tabs is not an observer, so the panel tracks its own reads */}
                {(tab) => <Observer>{() => (
                    <div className="settings-tab">
                        {tab === 'map' && <>
                        <p className="repository-details">
                            <code id="repo-name">{vm.repositoryDetails.name}</code>
                            <span id="stat">{vm.repositoryDetails.counts}</span>
                            <span id="repoinfo">{vm.repositoryDetails.revision}</span>
                        </p>
                        <section className="views-list" aria-labelledby="settings-views-title">
                            <h3 id="settings-views-title">Views</h3>
                            <p className="hint">Redraw a whole view of the repository. Uses the map agent (Agents tab).</p>
                            <ViewJobRow id="view-architecture" title="Architecture"
                                status={<>
                                    <p id="ms-text">{freshness}</p>
                                    <p className="mfiles" id="ms-files" hidden={st?.state !== 'stale' || !st.files?.length}>
                                        {st?.files?.slice(0, 12).join('  ·  ')}
                                        {(st?.changed || 0) > 12 ? '  · …' : ''}
                                    </p>
                                    {docs && <p id="ms-docs">{docs}</p>}
                                </>}
                                job={{ text: vm.jobStatus, entries: vm.busy || (vm.jobLog.last && vm.jobStatus.startsWith(vm.jobLog.last)) ? vm.jobLog.entries : [],
                                    busy: vm.busy, error: vm.jobError, onStop: vm.stopJob, statusId: 'job-status', stopId: 'job-stop' }}>
                                <button className="btn sm primary" id="ms-update" type="button" hidden={st?.state !== 'stale'}
                                    disabled={vm.jobsDisabled || !!st?.tooBig}
                                    title={st?.tooBig ? 'Too many changes for a quick update: redraw the map instead.' : vm.noAi || ''}
                                    onClick={() => void vm.runJob('update')}>
                                    Update map
                                </button>
                                <button className="btn sm" id="ms-mark" type="button" hidden={st?.state !== 'unrecorded'}
                                    disabled={vm.busy || vm.serverBusy} onClick={() => void vm.markCurrent()}>
                                    Mark as current
                                </button>
                                <button className="btn sm" id="ms-redraw" type="button" disabled={vm.jobsDisabled}
                                    title={vm.noAi || 'Explore the whole repo again and replace map.json. The current map is kept as .repo-map/map.prev.json. Takes several minutes.'}
                                    onClick={vm.redraw}>
                                    {vm.redrawArmed ? 'Confirm redraw' : vm.hasMap ? 'Redraw map' : 'Draw the full map'}
                                </button>
                                <button className="btn sm" id="ms-docs-go" type="button" hidden={!vm.hasMap} disabled={vm.jobsDisabled}
                                    title={vm.noAi || "Read the repo's documentation, agent guidance and code comments again, and link them to the cards (.repo-map/docs.json)."}
                                    onClick={() => void vm.runJob('docs')}>
                                    {d.linked ? 'Relink docs' : 'Link docs'}
                                </button>
                                <button className="btn sm" id="ms-dismiss" type="button" hidden={!vm.notice} onClick={vm.dismissNotice}>
                                    Dismiss notification
                                </button>
                            </ViewJobRow>
                            <RootViewRows vm={vm} />
                        </section>
                        </>}
                        {tab === 'agents' && <>
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
                        </>}
                        {tab === 'links' && vm.deps.workspace && <LinkedRepos model={vm.deps.workspace} />}
                    </div>
                )}</Observer>}
            </Tabs>
        </div>
    );
});

/** Views → Sitemap and Components: what each is like now, Generate / Regenerate, and the running job. */
const RootViewRows = observer(function RootViewRows({ vm }: { vm: SettingsViewModel }) {
    const { sitemap, components } = vm.deps;
    useEffect(() => { vm.loadViews(); }, [vm]);
    if (!sitemap || !components) return null;
    const job = (view: { busy: boolean; message: string; error: boolean; log: { entries: ProgressEntry[] }; stop(): void }, id: string) =>
        !view.busy && !view.message ? undefined : { text: view.message, entries: view.log.entries, busy: view.busy, error: view.error, onStop: view.stop,
            statusId: id + '-status', stopId: id + '-stop' };
    const sitemapExists = !!sitemap.sitemap;
    const componentsExist = !!components.components;
    // Both jobs share one server lock, and components are mapped from the sitemap's screens.
    const waitSitemap = 'Waits for the sitemap: components are mapped from its screens.';
    const waitComponents = 'Waits for components to finish.';
    return <>
        <ViewJobRow id="view-sitemap" title="Sitemap"
            status={sitemap.loading ? 'Checking…' : components.busy && !sitemap.busy ? waitComponents
                : sitemap.sitemap ? sitemap.freshnessLabel + '.' : 'Not generated yet.'}
            job={job(sitemap, 'view-sitemap')}>
            <button className="btn sm" id="view-sitemap-go" type="button" disabled={sitemap.busy || sitemap.loading || components.busy}
                title={components.busy ? waitComponents : "Analyze the repository's screens and navigation again, and replace .repo-map/sitemap.json."}
                onClick={vm.redrawSitemap}>
                {vm.armed === 'sitemap' ? 'Confirm regenerate' : sitemapExists ? 'Regenerate sitemap' : 'Generate sitemap'}
            </button>
        </ViewJobRow>
        <ViewJobRow id="view-components" title="Components"
            status={components.loading ? 'Checking…' : sitemap.busy && !components.busy ? waitSitemap
                : !components.canGenerate ? 'Needs the sitemap first: components are mapped from its screens.'
                : components.components ? components.freshnessLabel + '.' : 'Not generated yet.'}
            job={job(components, 'view-components')}>
            <button className="btn sm" id="view-components-go" type="button"
                disabled={components.busy || components.loading || !components.canGenerate || sitemap.busy}
                title={sitemap.busy ? waitSitemap : 'Map the UI components that build each screen again, and replace .repo-map/components.json.'}
                onClick={vm.redrawComponents}>
                {vm.armed === 'components' ? 'Confirm regenerate' : componentsExist ? 'Regenerate components' : 'Generate components'}
            </button>
        </ViewJobRow>
    </>;
});

import { makeAutoObservable, observableRef } from 'mobx';
import type { RepositoryModel } from '../../models/RepositoryModel';
import type { Services } from '../../shared/services/contracts';
import type { MapNode, RepoMap, Trace } from '../../models/types';
import { proposalMap } from '../../../../lib/proposal.mjs';
import { REPO_PREFIX, collapseRepos } from '../../../../lib/workspace-map.mjs';
import type { WorkspaceModel } from '../../models/WorkspaceModel';
import { neighborhood } from '../../shared/diagramFocus';

export interface ArchitectureDependencies {
    repo: RepositoryModel;
    services: Services;
    onReveal?: (id: string) => void;
    onInspect?: (id: string | null) => void;
    /** Linked repos (workspace.json); without it the map shows this repo only. */
    workspace?: WorkspaceModel;
}
export type MapScope = 'repo' | 'workspace';

export type ConnectionDirection = 'from' | 'to';
export interface CardConnection {
    edge: RepoMap['edges'][number];
    /** The card at the other end. */
    other: string;
}

export class ArchitectureViewModel {
    trace: Trace | null = null;
    groups: Record<string, boolean> = {};
    snapshot: Record<string, boolean> | null = null;
    query = '';
    keyOpen = false;
    hidden: Record<string, boolean> = { http: false, event: false, sync: false };
    hover: string | null = null;
    pinned: string | null = null;
    selected: string | null = null;
    /** Connection tab in card details; kept while moving between cards. */
    connectionTab: ConnectionDirection = 'from';
    revealId: string | null = null;
    revealVersion = 0;
    disposed = false;
    /** This repo only, or every linked repo in one map. */
    scopeChoice: MapScope = 'repo';
    /** `repo:<name>` ids folded into one card each (workspace view). */
    collapsedRepos: string[] = [];
    constructor(readonly deps: ArchitectureDependencies) {
        makeAutoObservable(this, { deps: false, trace: observableRef }, { autoBind: true });
        this.groups = deps.services.storage.get<Record<string, boolean>>(
            deps.repo.namespace + 'groups',
            {}
        );
        const storage = deps.services.storage;
        this.scopeChoice = storage.get<MapScope>(deps.repo.namespace + 'map-scope', 'repo') === 'workspace' ? 'workspace' : 'repo';
        const folded = storage.get<unknown>(deps.repo.namespace + 'repo-collapse', []);
        this.collapsedRepos = Array.isArray(folded) ? folded.filter((x): x is string => typeof x === 'string') : [];
    }
    get workspace() {
        return this.deps.workspace;
    }
    /** The scope actually shown: workspace only when another repo is linked. A workspace trace always shows the workspace. */
    get scope(): MapScope {
        if (!this.workspace?.linked) return 'repo';
        return this.scopeChoice === 'workspace' || this.trace?.scope === 'workspace' ? 'workspace' : 'repo';
    }
    setScope(scope: MapScope) {
        if (this.scopeChoice === scope) return;
        this.scopeChoice = scope;
        this.deps.services.storage.set(this.repo.namespace + 'map-scope', scope);
        this.dismiss();
    }
    isRepoCollapsed(name: string) {
        return this.collapsedRepos.includes(REPO_PREFIX + name);
    }
    toggleRepo(name: string) {
        const id = REPO_PREFIX + name;
        this.setCollapsedRepos(this.isRepoCollapsed(name) ? this.collapsedRepos.filter((x) => x !== id) : [...this.collapsedRepos, id]);
    }
    private setCollapsedRepos(ids: string[]) {
        this.collapsedRepos = ids;
        this.deps.services.storage.set(this.repo.namespace + 'repo-collapse', ids);
        if (this.selected && !this.nodes.has(this.selected)) this.dismiss();
    }
    /** Expand a collapsed repo card, optionally opening one of its cards. */
    expandCollapsed(id: string, select?: string) {
        const node = this.nodes.get(id);
        if (!node?.collapsed) return;
        this.setCollapsedRepos(this.collapsedRepos.filter((x) => 'c:' + x !== id));
        if (select) this.inspect(select);
        else this.dismiss();
    }
    /** A card's title, with its repo in the workspace view ("orders route (Shop API)"). */
    nodeTitle(id: string) {
        const n = this.nodes.get(id) || this.workspace?.view?.map.nodes.find((x) => x.id === id);
        const repo = this.repoTitle(n?.repo);
        return (n?.title || id) + (repo && !n?.collapsed ? ` (${repo})` : '');
    }
    /** Connections of a card that cross between repos. */
    seamsFor(id: string) {
        return this.map.edges.filter((e) => e.seam && (e.from === id || e.to === id));
    }
    /** Title of the repo a card or group comes from, in the workspace view. */
    repoTitle(repo: string | undefined) {
        return repo && repo !== 'home' ? this.workspace?.titles[repo] || repo : '';
    }
    get repo() {
        return this.deps.repo;
    }
    get map(): RepoMap {
        // proposals are drawn on this repo's map; other traces also read on the workspace map
        if (this.trace?.proposal) return proposalMap(this.repo.map, this.trace.proposal) as RepoMap;
        const merged = this.scope === 'workspace' ? this.workspace?.view?.map : null;
        return merged ? (collapseRepos(merged, this.collapsedRepos, this.workspace!.titles) as RepoMap) : this.repo.map;
    }
    get nodes() {
        return new Map(this.map.nodes.map((n) => [n.id, n]));
    }
    /** Connections of a card: From = edges arriving from other cards, To = edges leaving to them. */
    connectionsFor(id: string): Record<ConnectionDirection, CardConnection[]> {
        const edges = this.map.edges;
        return {
            from: edges.filter((e) => e.to === id).map((edge) => ({ edge, other: edge.from })),
            to: edges.filter((e) => e.from === id).map((edge) => ({ edge, other: edge.to })),
        };
    }
    setConnectionTab(tab: ConnectionDirection) {
        this.connectionTab = tab;
    }
    get inspected() {
        return this.selected ? this.nodes.get(this.selected) : undefined;
    }
    get active(): Set<string> | null {
        const id = this.hover || this.pinned;
        return id
            ? new Set(
                  id.startsWith('g:')
                      ? this.map.nodes.filter((n) => n.group === id.slice(2)).map((n) => n.id)
                      : [id]
              )
            : null;
    }
    get pairs() {
        return new Set([
            ...(this.trace?.edges || []).map((e) => e.join('|')),
            ...(this.trace?.proposal?.edges || []).map((e) => e.from + '|' + e.to),
        ]);
    }
    get relevant(): Set<string> | null {
        const active = this.active;
        if (active) return neighborhood(this.map.edges.filter((e) => !this.hidden[e.type]), active).nodes;
        return this.trace
            ? new Set([
                  ...this.trace.steps.map((s) => s.id),
                  ...(this.trace.proposal?.nodes || []).map((n) => n.id),
                  ...(this.trace.proposal?.edges || []).flatMap((e) => [e.from, e.to]),
              ])
            : null;
    }
    isOpen(id: string) {
        return this.groups[id] ?? !!this.map.groups.find((g) => g.id === id)?.open;
    }
    groupDim(id: string) {
        return (
            !!this.relevant &&
            !this.map.nodes.some((n) => n.group === id && this.relevant!.has(n.id))
        );
    }
    matches(n: MapNode) {
        const q = this.query.trim().toLowerCase();
        return !!q && [n.id, n.title || '', n.desc || ''].some((s) => s.toLowerCase().includes(q));
    }
    step(id: string) {
        return this.trace?.steps.findIndex((s) => s.id === id) ?? -1;
    }
    wireOn(from: string, to: string) {
        return this.active
            ? this.active.has(from) || this.active.has(to)
            : !!this.trace && this.pairs.has(from + '|' + to);
    }
    setGroup(id: string, open: boolean) {
        if (this.disposed || this.isOpen(id) === open) return;
        this.groups[id] = open;
        if (!this.trace && !this.snapshot)
            this.deps.services.storage.set(this.repo.namespace + 'groups', { ...this.groups });
    }
    expand(open: boolean) {
        this.map.groups.forEach((g) => this.setGroup(g.id, open));
    }
    setQuery(value: string) {
        this.query = value;
        this.map.nodes.filter(this.matches).forEach((n) => this.setGroup(n.group, true));
    }
    searchEnter() {
        const n = this.map.nodes.find(this.matches);
        if (n) this.inspect(n.id);
    }
    toggleKey() {
        this.keyOpen = !this.keyOpen;
    }
    toggleType(type: string) {
        this.hidden[type] = !this.hidden[type];
    }
    setHover(id: string | null) {
        this.hover = id;
    }
    inspect(id: string) {
        if (!this.nodes.has(id) || this.disposed) return;
        this.selected = id;
        this.pinned = id;
        this.hover = null;
        this.reveal(id);
        this.deps.onInspect?.(id);
    }
    toggleNode(id: string) {
        if (this.selected === id) this.dismiss();
        else this.inspect(id);
    }
    dismiss() {
        this.selected = null;
        this.pinned = null;
        this.hover = null;
        this.deps.onInspect?.(null);
    }
    setTrace(trace: Trace | null) {
        if (this.disposed) return;
        if (trace && !this.snapshot)
            this.snapshot = Object.fromEntries(
                this.map.groups.map((g) => [g.id, this.isOpen(g.id)])
            );
        this.trace = trace;
        if (!trace && this.snapshot) {
            this.groups = this.snapshot;
            this.snapshot = null;
        }
        if (trace) {
            const ids = new Set(trace.steps.map((s) => s.id));
            this.groups = Object.fromEntries(
                this.map.groups.map((g) => [
                    g.id,
                    this.map.nodes.some((n) => n.group === g.id && ids.has(n.id)) ||
                        !!trace.proposal?.nodes.some((n) => n.group === g.id),
                ])
            );
        }
        this.dismiss();
    }
    reveal(id: string) {
        const n = this.nodes.get(id);
        if (!n || this.disposed) return;
        this.setGroup(n.group, true);
        this.revealId = id;
        this.revealVersion++;
        this.deps.onReveal?.(id);
    }
    dispose() {
        this.disposed = true;
        this.deps.onInspect?.(null);
    }
}

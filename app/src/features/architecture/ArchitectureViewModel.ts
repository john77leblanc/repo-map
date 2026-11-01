import { makeAutoObservable, observableRef } from 'mobx';
import type { RepositoryModel } from '../../models/RepositoryModel';
import type { Services } from '../../shared/services/contracts';
import type { CodeRef, MapNode, RepoMap, ReviewFile, Trace } from '../../models/types';
import { proposalMap } from '../../../../lib/proposal.mjs';
import { REPO_PREFIX, collapseRepos } from '../../../../lib/workspace-map.mjs';
import type { WorkspaceModel } from '../../models/WorkspaceModel';
import { neighborhood } from '../../shared/diagramFocus';
import { SearchModel, pinFirst, type SearchSection } from '../../shared/search/SearchModel';

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
/** Collapsible sections of the card details panel. */
export type CardSection = 'about' | 'docs' | 'files' | 'connections';
const kinds: Record<string, string> = { service: 'svc', topic: 'topic', external: 'ext' };
export interface CardConnection {
    edge: RepoMap['edges'][number];
    /** The card at the other end. */
    other: string;
}

export class ArchitectureViewModel {
    trace: Trace | null = null;
    groups: Record<string, boolean> = {};
    snapshot: Record<string, boolean> | null = null;
    keyOpen = false;
    hidden: Record<string, boolean> = { http: false, event: false, sync: false };
    hover: string | null = null;
    pinned: string | null = null;
    selected: string | null = null;
    /** Search results in the side panel (a picked card shows over them). */
    readonly search = new SearchModel({ sections: () => this.searchSource, onQuery: () => this.openMatchedGroups() });
    /** Connection tab in card details; kept while moving between cards. */
    connectionTab: ConnectionDirection = 'from';
    /** Open card sections; kept while moving between cards. */
    sections: Record<CardSection, boolean> = { about: false, docs: false, files: false, connections: false };
    /** Trace step shown in card details (a card can be visited more than once). */
    stepAt: number | null = null;
    revealId: string | null = null;
    revealVersion = 0;
    disposed = false;
    /** This repo only, or every linked repo in one map. */
    scopeChoice: MapScope = 'repo';
    /** `repo:<name>` ids folded into one card each (workspace view). */
    collapsedRepos: string[] = [];
    /** With a trace open, draw only its cards and path (remembered per browser). */
    traceOnly = true;
    constructor(readonly deps: ArchitectureDependencies) {
        makeAutoObservable(this, { deps: false, trace: observableRef, search: false }, { autoBind: true });
        this.groups = deps.services.storage.get<Record<string, boolean>>(
            deps.repo.namespace + 'groups',
            {}
        );
        const storage = deps.services.storage;
        this.scopeChoice = storage.get<MapScope>(deps.repo.namespace + 'map-scope', 'repo') === 'workspace' ? 'workspace' : 'repo';
        const folded = storage.get<unknown>(deps.repo.namespace + 'repo-collapse', []);
        this.collapsedRepos = Array.isArray(folded) ? folded.filter((x): x is string => typeof x === 'string') : [];
        this.traceOnly = storage.get<boolean>(deps.repo.namespace + 'trace-only', true) !== false;
    }
    setTraceOnly(on: boolean) {
        this.traceOnly = on;
        this.deps.services.storage.set(this.repo.namespace + 'trace-only', on);
    }
    /** Card id drawn for a map id: itself, or the folded repo card holding it. */
    get aliases() {
        return new Map(this.map.nodes.flatMap((n) => (n.members || []).map((m) => [m, n.id] as const)));
    }
    private drawn(id: string) {
        return this.aliases.get(id) ?? id;
    }
    /** Cards the trace touches: its steps and the proposal's cards and wire ends. */
    get traceIds(): Set<string> {
        const t = this.trace;
        if (!t) return new Set();
        const ids = [
            ...t.steps.map((s) => s.id),
            ...(t.proposal?.nodes || []).map((n) => n.id),
            ...(t.proposal?.edges || []).flatMap((e) => [e.from, e.to]),
        ].map(this.drawn);
        return new Set(ids.filter((id) => this.nodes.has(id)));
    }
    /** The trace-only filter is in effect (a trace with cards on this map). */
    get filtering() {
        return this.traceOnly && this.traceIds.size > 0;
    }
    /** The map as drawn: with the filter, only traced cards (plus an opened card), their groups and the trace's path. */
    get shown(): RepoMap {
        const map = this.map;
        if (!this.filtering) return map;
        const keep = new Set(this.traceIds);
        if (this.selected) keep.add(this.selected);
        const nodes = map.nodes.filter((n) => keep.has(n.id));
        const groups = new Set(nodes.map((n) => n.group));
        return {
            ...map,
            nodes,
            groups: map.groups.filter((g) => groups.has(g.id)),
            edges: map.edges.filter((e) => this.pairs.has(e.from + '|' + e.to)),
        };
    }
    /** Columns drawn: all of them, or only those holding a shown group while filtering. */
    colShown(col: number) {
        return !this.filtering || this.shown.groups.some((g) => g.col === col);
    }
    get workspace() {
        return this.deps.workspace;
    }
    /** The scope actually shown: workspace only when another repo is linked. A workspace trace always shows the workspace. */
    get scope(): MapScope {
        if (!this.workspace?.linked) return 'repo';
        return this.scopeChoice === 'workspace' || this.scopeLocked ? 'workspace' : 'repo';
    }
    /** A workspace trace needs the workspace map, so the scope can't switch while one is open. */
    get scopeLocked() {
        return this.trace?.scope === 'workspace';
    }
    setScope(scope: MapScope) {
        if (this.scopeChoice === scope) return;
        this.scopeChoice = scope;
        this.deps.services.storage.set(this.repo.namespace + 'map-scope', scope);
        this.backToResults();
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
        if (this.selected && !this.nodes.has(this.selected)) this.backToResults();
    }
    /** Expand a collapsed repo card, optionally opening one of its cards. */
    expandCollapsed(id: string, select?: string) {
        const node = this.nodes.get(id);
        if (!node?.collapsed) return;
        this.setCollapsedRepos(this.collapsedRepos.filter((x) => 'c:' + x !== id));
        if (select) this.inspect(select);
        else this.backToResults();
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
    /** A review's changed files in this card, each with the reference that opens its diff. */
    changedFiles(id: string): { file: ReviewFile; ref: CodeRef }[] {
        const review = this.trace?.review;
        if (!review) return [];
        const diff = { base: review.mergeBase, head: review.kind === 'local' ? '' : review.headSha };
        return review.files.filter((f) => f.cards.includes(id))
            .map((file) => ({ file, ref: { path: file.path, start: 1, end: 1, why: file.note || undefined, diff } }));
    }
    setSection(name: CardSection, open: boolean) {
        this.sections[name] = open;
    }
    /** Index of the trace step shown for the open card, or -1. */
    get currentStep() {
        const steps = this.trace?.steps || [];
        if (!this.selected) return -1;
        if (this.stepAt !== null && steps[this.stepAt]?.id === this.selected) return this.stepAt;
        return steps.findIndex((s) => s.id === this.selected);
    }
    get hasPrev() {
        return this.currentStep > 0;
    }
    get hasNext() {
        const i = this.currentStep;
        return i >= 0 && i < (this.trace?.steps.length ?? 0) - 1;
    }
    /** Open trace step `i` and its card. */
    goStep(i: number) {
        const step = this.trace?.steps[i];
        if (!step || !this.nodes.has(step.id) || this.disposed) return;
        this.stepAt = i;
        this.select(step.id);
    }
    prevStep() {
        if (this.hasPrev) this.goStep(this.currentStep - 1);
    }
    nextStep() {
        if (this.hasNext) this.goStep(this.currentStep + 1);
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
        const pair = (from: string, to: string) => this.drawn(from) + '|' + this.drawn(to);
        return new Set([
            ...(this.trace?.edges || []).map((e) => pair(e[0], e[1])),
            ...(this.trace?.proposal?.edges || []).map((e) => pair(e.from, e.to)),
        ]);
    }
    get relevant(): Set<string> | null {
        const active = this.active;
        if (active) return neighborhood(this.shown.edges.filter((e) => !this.hidden[e.type]), active).nodes;
        return this.trace ? this.traceIds : null;
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
        return this.search.matched.has(n.id);
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
    /** Every group is open, so the groups button collapses them. */
    get allOpen() {
        return this.map.groups.length > 0 && this.map.groups.every((g) => this.isOpen(g.id));
    }
    /** Expand all while any group is closed; collapse all once every group is open. */
    toggleGroups() {
        this.expand(!this.allOpen);
    }
    get query() {
        return this.search.query;
    }
    get searchOpen() {
        return this.search.open;
    }
    setQuery(value: string) {
        this.search.setQuery(value);
    }
    /** Typing opens the groups holding matches. */
    private openMatchedGroups() {
        this.map.nodes.filter(this.matches).forEach((n) => this.setGroup(n.group, true));
    }
    /** Every card by column, then group; in a trace, its cards first. */
    get searchSource(): SearchSection[] {
        const columns = this.repo.bootstrap?.config.columns || [];
        const sections = columns.map((c, col) => ({
            id: 'col-' + col,
            title: c.title,
            groups: this.map.groups
                .filter((g) => g.col === col)
                .map((g) => ({
                    id: g.id,
                    title: g.title,
                    tag: this.repoTitle(g.id.startsWith(REPO_PREFIX) ? undefined : g.repo) || undefined,
                    items: this.map.nodes
                        .filter((n) => n.group === g.id)
                        .map((n) => ({
                            id: n.id,
                            title: n.title || n.id,
                            names: [n.id, n.title || ''],
                            desc: n.desc,
                            paths: [n.path, n.suggestedPath].filter((p): p is string => !!p),
                            kind: kinds[n.kind] || 'svc',
                        })),
                })),
        }));
        const visited = [...(this.trace?.steps || []).map((s) => this.drawn(s.id)), ...this.traceIds];
        return pinFirst(sections, visited, this.trace?.intent === 'review' ? 'In this review' : 'In this trace');
    }
    /** The side panel shows a card, or the search results. */
    get sideOpen() {
        return !!this.inspected || this.search.open;
    }
    openSearch() {
        this.search.openSearch();
        this.backToResults();
    }
    searchEnter() {
        const id = this.search.current;
        if (id) this.inspect(id);
    }
    /** Leave the picked card, showing the search results again. */
    backToResults() {
        this.selected = null;
        this.stepAt = null;
        this.pinned = null;
        this.hover = null;
        this.deps.onInspect?.(null);
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
    /** Open a card; a trace card shows its next visit after the current step, else its first. */
    inspect(id: string) {
        if (!this.nodes.has(id) || this.disposed) return;
        const visits = (this.trace?.steps || []).flatMap((s, i) => (s.id === id ? [i] : []));
        const from = this.stepAt ?? -1;
        this.stepAt = visits.length ? visits.find((i) => i > from) ?? visits[0] : null;
        this.select(id);
    }
    private select(id: string) {
        this.selected = id;
        this.pinned = id;
        this.hover = null;
        this.reveal(id);
        this.deps.onInspect?.(id);
    }
    toggleNode(id: string) {
        if (this.selected === id) this.backToResults();
        else this.inspect(id);
    }
    /** Close the side panel: the card and the search. */
    dismiss() {
        this.search.close();
        this.selected = null;
        this.stepAt = null;
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
            const ids = this.traceIds;
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

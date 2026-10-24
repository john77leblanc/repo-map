import { makeAutoObservable, observableRef } from 'mobx';
import type { RepositoryModel } from '../../models/RepositoryModel';
import type { Services } from '../../shared/services/contracts';
import type { MapNode, RepoMap, Trace } from '../../models/types';
import { proposalMap } from '../../../../lib/proposal.mjs';
import { neighborhood } from '../../shared/diagramFocus';

export interface ArchitectureDependencies {
    repo: RepositoryModel;
    services: Services;
    onReveal?: (id: string) => void;
    onInspect?: (id: string | null) => void;
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
    revealId: string | null = null;
    revealVersion = 0;
    disposed = false;
    constructor(readonly deps: ArchitectureDependencies) {
        makeAutoObservable(this, { deps: false, trace: observableRef }, { autoBind: true });
        this.groups = deps.services.storage.get<Record<string, boolean>>(
            deps.repo.namespace + 'groups',
            {}
        );
    }
    get repo() {
        return this.deps.repo;
    }
    get map(): RepoMap {
        return this.trace?.proposal
            ? (proposalMap(this.repo.map, this.trace.proposal) as RepoMap)
            : this.repo.map;
    }
    get nodes() {
        return new Map(this.map.nodes.map((n) => [n.id, n]));
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

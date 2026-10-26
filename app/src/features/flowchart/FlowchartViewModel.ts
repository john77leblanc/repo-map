import { makeAutoObservable, observable, isObservable, observableRef, runInAction } from 'mobx';
import type { RepositoryModel } from '../../models/RepositoryModel';
import type { AgentPick, ChangeStatus, CollapseGroup, Flow, Trace, StreamResult } from '../../models/types';
import { collapseGraph } from '../../../../lib/collapse.mjs';
import type { Services } from '../../shared/services/contracts';
import { fitCaptions, layoutFlow, renderFlowSvg } from '../../../flowchart.mjs';
import { DiagramFocusModel } from '../../shared/DiagramFocusModel';
import { normalizeFlow, flowToMermaid, flowLanes, countInferred } from '../../../../lib/flow.mjs';
import { traceOutputs } from '../../../../lib/trace-outputs.mjs';
import { FC_CSS } from './styles';
import { standaloneSvg, diagramFilename } from '../../shared/diagramExport';

export interface FlowchartDeps {
    repo: RepositoryModel;
    services: Services;
    getPick: () => AgentPick;
    saveTrace: (trace: Trace) => Promise<unknown>;
    onTraceUpdated: (trace: Trace) => void;
    onNodeSelected?: (id: string | null) => void;
}
export type ConnectionTab = 'from' | 'to';
export interface FlowConnection {
    edge: Flow['edges'][number];
    index: number;
    other: string;
}
/** What the reader has folded away: whole lanes, and named groups of boxes. Saved per trace in the browser. */
export interface FlowCollapse {
    lanes: string[];
    groups: CollapseGroup[];
}
const LANE_GROUP = 'lane:';
const emptyCollapse = (): FlowCollapse => ({ lanes: [], groups: [] });
function readCollapse(value: unknown): FlowCollapse {
    const raw = value && typeof value === 'object' ? (value as Partial<FlowCollapse>) : {};
    return {
        lanes: Array.isArray(raw.lanes) ? raw.lanes.filter((id) => typeof id === 'string') : [],
        groups: Array.isArray(raw.groups)
            ? raw.groups.filter((g) => g && typeof g.id === 'string' && Array.isArray(g.members))
                .map((g) => ({ id: g.id, label: String(g.label || ''), members: g.members.filter((m) => typeof m === 'string') }))
            : [],
    };
}
export class FlowchartViewModel {
    trace: Trace | null = null;
    selectedId: string | null = null;
    collapse: FlowCollapse = emptyCollapse();
    /** Boxes picked with shift-click, waiting to be collapsed together. */
    marked: string[] = [];
    connectionTab: ConnectionTab = 'to';
    scale = 1;
    keyOpen = false;
    busy = false;
    status = '';
    error = false;
    copied = false;
    compact = false;
    readonly focus = new DiagramFocusModel({ layout: () => this.layout, selected: () => this.selectedId });
    private controller: AbortController | null = null;
    private revision = 0;
    private disposed = false;
    private copyTimer: ReturnType<typeof setTimeout> | null = null;
    constructor(readonly deps: FlowchartDeps) {
        this.compact = deps.services.storage.get<boolean>(deps.repo.namespace + 'flow-compact', false) === true;
        makeAutoObservable<
            FlowchartViewModel,
            'controller' | 'revision' | 'disposed' | 'copyTimer'
        >(
            this,
            {
                deps: false,
                focus: false,
                trace: observableRef,
                controller: false,
                revision: false,
                disposed: false,
                copyTimer: false,
            },
            { autoBind: true }
        );
    }
    get repo() {
        return this.deps.repo;
    }
    /** Every group to fold right now: collapsed lanes first, then named groups. */
    get collapseGroups(): CollapseGroup[] {
        const flow = this.trace?.flow;
        if (!flow) return [];
        const lanes = this.collapse.lanes.map((lane) => ({
            id: LANE_GROUP + lane,
            label: flow.lanes?.find((l) => l.id === lane)?.label || lane,
            members: flow.nodes.filter((n) => n.lane === lane).map((n) => n.id),
        }));
        return [...lanes, ...this.collapse.groups];
    }
    /** The flow as drawn: the saved flow with the reader's collapsed groups folded in. */
    get displayFlow(): Flow | null {
        const flow = this.trace?.flow;
        if (!flow) return null;
        return this.collapseGroups.length ? (collapseGraph(flow, this.collapseGroups) as Flow) : flow;
    }
    get collapsedCount() {
        return this.displayFlow?.nodes.filter((n) => n.collapsed).length || 0;
    }
    /** Suggested chunks not yet folded. */
    get openChunks() {
        const shown = new Set(this.displayFlow?.nodes.map((n) => n.id));
        return (this.trace?.flow?.chunks || []).filter((c) => c.nodes.every((id) => shown.has(id)));
    }
    get layout() {
        const flow = this.displayFlow;
        return flow ? fitCaptions(layoutFlow(flow, { lanes: !this.compact })) : null;
    }
    private get collapseKey() {
        const t = this.trace;
        return t ? `${this.repo.namespace}flow-collapse:${t._doc || t.key || t.title}` : '';
    }
    private saveCollapse() {
        if (this.collapseKey) this.deps.services.storage.set(this.collapseKey, this.collapse);
        // A selected box that was just folded away hands the selection to its group.
        const shown = this.displayFlow?.nodes || [];
        if (this.selectedId && !shown.some((n) => n.id === this.selectedId))
            this.select(shown.find((n) => n.members?.includes(this.selectedId!))?.id || null);
        this.marked = this.marked.filter((id) => shown.some((n) => n.id === id));
    }
    /** A lane needs two or more boxes to be worth folding. */
    laneFoldable(id: string) {
        return (this.trace?.flow?.nodes.filter((n) => n.lane === id).length || 0) >= 2;
    }
    isLaneCollapsed(id: string) {
        return this.collapse.lanes.includes(id);
    }
    toggleLane(id: string) {
        const lanes = this.isLaneCollapsed(id) ? this.collapse.lanes.filter((l) => l !== id) : [...this.collapse.lanes, id];
        this.collapse = { ...this.collapse, lanes };
        this.saveCollapse();
    }
    /** Shift-click: add or remove a box from the pending group. Collapsed boxes can't be nested. */
    mark(id: string) {
        const node = this.displayFlow?.nodes.find((n) => n.id === id);
        if (!node || node.collapsed) return;
        this.marked = this.marked.includes(id) ? this.marked.filter((m) => m !== id) : [...this.marked, id];
    }
    clearMarks() {
        this.marked = [];
    }
    collapseMarked(label = '') {
        if (this.marked.length < 2) return;
        const taken = new Set(this.collapse.groups.map((g) => g.id));
        let n = this.collapse.groups.length + 1;
        while (taken.has(`s${n}`)) n++;
        const members = this.trace?.flow?.nodes.map((node) => node.id).filter((id) => this.marked.includes(id)) || [];
        this.collapse = { ...this.collapse, groups: [...this.collapse.groups, { id: `s${n}`, label: label.trim(), members }] };
        this.marked = [];
        this.saveCollapse();
        this.select(`c:s${n}`);
    }
    collapseChunk(id: string) {
        const chunk = this.trace?.flow?.chunks?.find((c) => c.id === id);
        if (!chunk || this.collapse.groups.some((g) => g.id === 'chunk:' + id)) return;
        this.collapse = { ...this.collapse, groups: [...this.collapse.groups, { id: 'chunk:' + id, label: chunk.label, members: chunk.nodes }] };
        this.saveCollapse();
    }
    collapseSuggested() {
        this.openChunks.forEach((c) => this.collapseChunk(c.id));
    }
    /** Unfold one collapsed box (by its drawn id), optionally selecting one of its steps. */
    expand(collapsedId: string, select: string | null = null) {
        const id = collapsedId.replace(/^c:/, '');
        this.collapse = id.startsWith(LANE_GROUP)
            ? { ...this.collapse, lanes: this.collapse.lanes.filter((l) => l !== id.slice(LANE_GROUP.length)) }
            : { ...this.collapse, groups: this.collapse.groups.filter((g) => g.id !== id) };
        this.saveCollapse();
        if (select) this.select(select);
        else if (this.selectedId === collapsedId) this.select(null);
    }
    expandAll() {
        this.collapse = emptyCollapse();
        this.saveCollapse();
    }
    renameGroup(collapsedId: string, label: string) {
        const id = collapsedId.replace(/^c:/, '');
        this.collapse = { ...this.collapse, groups: this.collapse.groups.map((g) => (g.id === id ? { ...g, label } : g)) };
        if (this.collapseKey) this.deps.services.storage.set(this.collapseKey, this.collapse);
    }
    /** True for named groups the reader made or accepted; lanes keep their lane name. */
    canRename(collapsedId: string) {
        return !collapsedId.startsWith('c:' + LANE_GROUP);
    }
    /** Hidden steps of a collapsed box, in flow order. */
    members(collapsedId: string) {
        const node = this.displayFlow?.nodes.find((n) => n.id === collapsedId);
        const ids = new Set(node?.members || []);
        return (this.trace?.flow?.nodes || []).filter((n) => ids.has(n.id));
    }
    /** What DiagramSvg keeps bright: the hovered node, else the selected one, with its links and neighbours. */
    get highlight() {
        return this.focus.highlight;
    }
    hoverNode(id: string | null) {
        this.focus.hover(id);
    }
    hoverEdge(index: number | null) {
        this.focus.hoverEdge(index);
    }
    get hasLanes() {
        return !!this.trace?.flow && flowLanes(this.trace.flow).filter((lane: { id: string }) => lane.id).length >= 2;
    }
    get selectedLane() {
        if (!this.selected || !this.trace?.flow?.lanes?.length) return '';
        return this.trace.flow.lanes.find((lane) => lane.id === this.selected?.lane)?.label || 'Unassigned';
    }
    setCompact(value: boolean) {
        this.compact = value;
        this.deps.services.storage.set(this.repo.namespace + 'flow-compact', value);
    }
    get svg() {
        return this.layout ? renderFlowSvg(this.layout, { title: this.trace?.title }) : '';
    }
    get selected() {
        return this.displayFlow?.nodes.find((node) => node.id === this.selectedId) || null;
    }
    get references() {
        const step = this.selected?.step;
        const id = step ? this.trace?.steps[step - 1]?.id : null;
        return id
            ? [
                  ...(this.trace?.refs || []).filter((ref) => ref.step === id),
                  ...(this.repo.docs[id] || []),
              ]
            : [];
    }
    get inferred(): number {
        return countInferred(this.trace?.flow);
    }
    /** Edges arriving at (from) and leaving (to) the selected node, with their index for edge highlighting. */
    get connections() {
        const empty = { from: [] as FlowConnection[], to: [] as FlowConnection[] };
        const id = this.selectedId;
        // Layout edges, not flow edges: their indices are what the diagram highlights.
        const edges = this.layout?.edges as Flow['edges'] | undefined;
        if (!id || !edges) return empty;
        edges.forEach((edge, index) => {
            if (edge.to === id) empty.from.push({ edge, index, other: edge.from });
            if (edge.from === id) empty.to.push({ edge, index, other: edge.to });
        });
        return empty;
    }
    /** Proposal status for the selected node, with the rationale from its linked architecture change. */
    get selectedChange(): { status: ChangeStatus; rationale: string } | null {
        const node = this.selected;
        if (!node || this.trace?.intent !== 'proposal') return null;
        const stepId = node.step ? this.trace.steps[node.step - 1]?.id : null;
        const change = stepId ? this.trace.proposal?.nodes.find((n) => n.id === stepId) : undefined;
        const status = node.status || change?.status;
        return status ? { status, rationale: change?.rationale || '' } : null;
    }
    nodeLabel(id: string) {
        return this.displayFlow?.nodes.find((node) => node.id === id)?.label || id;
    }
    setConnectionTab(tab: ConnectionTab) {
        this.connectionTab = tab;
    }
    /** Side-panel connection hover: the edge, with the node the row names as the main highlight. */
    hoverConnection(index: number | null, other: string | null = null) {
        this.focus.hoverEdge(index, other);
    }
    close() {
        this.select(null);
    }
    setTrace(trace: Trace | null) {
        this.stop(false);
        this.trace = trace ? (isObservable(trace) ? trace : observable(trace)) : null;
        this.copied = false;
        this.selectedId = null;
        this.marked = [];
        this.collapse = this.collapseKey ? readCollapse(this.deps.services.storage.get(this.collapseKey, null)) : emptyCollapse();
        this.focus.reset();
        this.status = '';
        this.error = false;
    }
    select(id: string | null) {
        this.selectedId = id;
        this.deps.onNodeSelected?.(id);
    }
    toggleKey() {
        this.keyOpen = !this.keyOpen;
    }
    setScale(scale: number) {
        this.scale = Math.max(0.3, Math.min(2.5, scale));
    }
    zoom(factor: number) {
        this.setScale(this.scale * factor);
    }
    fit(width: number, height: number, zoom = 1) {
        if (this.layout)
            this.setScale(
                Math.max(
                    0.65,
                    Math.min(
                        1,
                        (width - 24) / this.layout.width,
                        (height - 92) / this.layout.height
                    )
                ) * zoom
            );
    }
    stop(showStatus = true) {
        this.revision++;
        this.controller?.abort();
        this.controller = null;
        if (this.busy && showStatus) {
            this.status = 'Stopped.';
            this.error = true;
        }
        this.busy = false;
    }
    async generate(trace: Trace) {
        if (this.disposed || this.busy) return;
        this.setTrace(trace);
        trace = this.trace!;
        const controller = new AbortController();
        const revision = ++this.revision;
        const current = () =>
            !this.disposed && this.revision === revision && !controller.signal.aborted;
        this.controller = controller;
        this.busy = true;
        this.status = 'Starting…';
        const started = Date.now();
        let progress = this.status;
        const tick = () => {
            if (current())
                runInAction(() => {
                    this.status = `${progress} · ${Math.round((Date.now() - started) / 1000)}s`;
                });
        };
        const timer = setInterval(tick, 1000);
        try {
            const result = await this.deps.services.api.stream<StreamResult>(
                '/api/flow',
                { trace, ...this.deps.getPick() },
                controller.signal,
                (text) => {
                    progress = text;
                    tick();
                }
            );
            if (!current()) return;
            const flow = normalizeFlow(result.flow, trace.steps.length) as Flow | null;
            if (!flow) throw new Error('The AI tool ended without a usable flowchart.');
            const updated = observable<Trace>({
                ...trace,
                flow,
                pendingFlow: false,
                outputs: { ...traceOutputs(trace), flowchart: true },
            });
            runInAction(() => {
                this.trace = updated;
                this.selectedId = null;
                this.focus.reset();
                this.status = '';
            });
            await this.deps.saveTrace(updated);
            if (current())
                runInAction(() => {
                    this.deps.onTraceUpdated(updated);
                });
        } catch (error) {
            if (current())
                runInAction(() => {
                    this.error = true;
                    this.status = error instanceof Error ? error.message : String(error);
                });
        } finally {
            clearInterval(timer);
            if (current())
                runInAction(() => {
                    this.busy = false;
                    this.controller = null;
                });
        }
    }
    async copyMermaid() {
        if (!this.trace?.flow || this.disposed) return;
        const revision = this.revision;
        try {
            await this.deps.services.browser.copy(flowToMermaid(this.displayFlow || this.trace.flow, this.trace.title));
            if (this.disposed || revision !== this.revision) return;
            runInAction(() => {
                this.copied = true;
            });
            if (this.copyTimer) clearTimeout(this.copyTimer);
            this.copyTimer = setTimeout(
                () =>
                    runInAction(() => {
                        this.copied = false;
                    }),
                1500
            );
        } catch {
            if (!this.disposed && revision === this.revision)
                runInAction(() => {
                    this.status = "Couldn't copy to the clipboard.";
                    this.error = true;
                });
        }
    }
    downloadSvg(resolve: (variable: string) => string) {
        if (!this.layout || !this.trace) return;
        const svg = standaloneSvg(this.svg, FC_CSS, resolve);
        const name = diagramFilename(this.trace.title || 'flowchart', 'flowchart');
        this.deps.services.browser.download(name + '.svg', svg, 'image/svg+xml');
    }
    dispose() {
        this.stop(false);
        this.disposed = true;
        if (this.copyTimer) clearTimeout(this.copyTimer);
    }
}

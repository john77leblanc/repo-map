import { makeAutoObservable, observable, isObservable, observableRef, runInAction } from 'mobx';
import type { RepositoryModel } from '../../models/RepositoryModel';
import type { AgentPick, ChangeStatus, CollapseGroup, Flow, FlowExpansion, Trace, StreamResult } from '../../models/types';
import { expandFlow, expandable, normalizeExpansion, subRefs } from '../../../../lib/flow-expand.mjs';
import { hasChanges, plain } from '../../models/trace';
import { collapseGraph } from '../../../../lib/collapse.mjs';
import type { Services } from '../../shared/services/contracts';
import { fitCaptions, layoutFlow, renderFlowSvg } from '../../../flowchart.mjs';
import { DiagramFocusModel } from '../../shared/DiagramFocusModel';
import { CopyFeedback } from '../../models/CopyFeedback';
import { normalizeFlow, flowToMermaid, flowLanes, flowRepos, countInferred } from '../../../../lib/flow.mjs';
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
/** Collapsible sections of the step details panel. */
export type StepSection = 'about' | 'refs' | 'connections';
/** Where a job's status shows: the diagram toolbar, or beside a box's closer look (its id). */
const CHART = 'chart';
export interface FlowConnection {
    edge: Flow['edges'][number];
    index: number;
    other: string;
}
/** What the reader has folded away: whole repos, whole lanes, and named groups of boxes. Saved per trace in the browser. */
export interface FlowCollapse {
    lanes: string[];
    groups: CollapseGroup[];
    /** Repo bands of a workspace trace. */
    repos?: string[];
}
const LANE_GROUP = 'lane:';
const REPO_GROUP = 'repo:';
const emptyCollapse = (): FlowCollapse => ({ lanes: [], groups: [], repos: [] });
const strings = (value: unknown) => (Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []);
function readCollapse(value: unknown): FlowCollapse {
    const raw = value && typeof value === 'object' ? (value as Partial<FlowCollapse>) : {};
    return {
        repos: strings(raw.repos),
        lanes: strings(raw.lanes),
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
    selecting = false;
    connectionTab: ConnectionTab = 'to';
    /** Open step sections; kept while moving between steps. */
    sections: Record<StepSection, boolean> = { about: false, refs: false, connections: false };
    scale = 1;
    keyOpen = false;
    busy = false;
    status = '';
    /** `'chart'` for the toolbar, else the box whose closer look the status belongs to. */
    statusTarget = CHART;
    error = false;
    readonly copy = new CopyFeedback();
    compact = false;
    /** Boxes whose closer look is drawn in the chart. Saved per trace in the browser. */
    shown: string[] = [];
    /** The box a closer look is being made for. */
    expandingId: string | null = null;
    readonly focus = new DiagramFocusModel({ layout: () => this.layout, selected: () => this.selectedId });
    private controller: AbortController | null = null;
    private revision = 0;
    private disposed = false;
    constructor(readonly deps: FlowchartDeps) {
        this.compact = deps.services.storage.get<boolean>(deps.repo.namespace + 'flow-compact', false) === true;
        makeAutoObservable<
            FlowchartViewModel,
            'controller' | 'revision' | 'disposed'
        >(
            this,
            {
                deps: false,
                focus: false,
                copy: false,
                trace: observableRef,
                controller: false,
                revision: false,
                disposed: false,
            },
            { autoBind: true }
        );
    }
    /** The Export button reads "Copied!" for a moment after Copy Mermaid. */
    get copied() {
        return this.copy.copied;
    }
    get repo() {
        return this.deps.repo;
    }
/** Every group to fold right now: collapsed repos first (they win any overlap), then lanes, then named groups. */
    get collapseGroups(): CollapseGroup[] {
        const flow = this.baseFlow;
        if (!flow) return [];
        const bands = this.repoBands;
        const repos = (this.collapse.repos || []).map((repo) => bands.find((b) => b.id === repo)).filter((b) => !!b).map((band) => ({
            id: REPO_GROUP + band.id,
            label: band.label,
            members: this.bandMembers(band.id),
        }));
        const lanes = this.collapse.lanes.map((lane) => ({
            id: LANE_GROUP + lane,
            label: flow.lanes?.find((l) => l.id === lane)?.label || lane,
            members: flow.nodes.filter((n) => n.lane === lane).map((n) => n.id),
        }));
        return [...repos, ...lanes, ...this.collapse.groups];
    }
    /** Boxes in a repo band's lanes (an unassigned box sits in the '' lane). */
    private bandMembers(id: string) {
        const lanes = this.repoBands.find((b) => b.id === id)?.lanes || [];
        return (this.baseFlow?.nodes || []).filter((n) => lanes.includes(n.lane && this.trace?.flow?.lanes?.some((l) => l.id === n.lane) ? n.lane : '')).map((n) => n.id);
    }
    /** The saved flow with the shown closer looks drawn in place of their boxes. */
    get baseFlow(): Flow | null {
        const flow = this.trace?.flow;
        return flow ? (expandFlow(flow, this.trace?.expansions, this.shown) as Flow) : null;
    }
    /** The flow as drawn: the expanded flow with the reader's collapsed groups folded in. */
    get displayFlow(): Flow | null {
        const flow = this.baseFlow;
        if (!flow) return null;
        if (!this.collapseGroups.length) return flow;
        const out = collapseGraph(flow, this.collapseGroups) as Flow;
        // A collapsed repo spans its lanes: draw it in the repo's first lane, inside its band.
        out.nodes = out.nodes.map((n) => {
            if (!n.id.startsWith('c:' + REPO_GROUP)) return n;
            const lane = this.repoBands.find((b) => b.id === n.id.slice(2 + REPO_GROUP.length))?.lanes[0];
            return lane ? { ...n, lane } : n;
        });
        // That lane's heading then stands for all of them ("2 lanes").
        const folded = this.repoBands.filter((b) => this.isRepoCollapsed(b.id) && b.lanes.length > 1);
        if (folded.length && out.lanes) {
            out.lanes = out.lanes.map((lane) => {
                const band = folded.find((b) => b.lanes[0] === lane.id);
                return band ? { ...lane, label: `${band.lanes.length} lanes` } : lane;
            });
        }
        return out;
    }
    /** Repo bands of a workspace trace's flowchart. */
    get repoBands(): { id: string; label: string; lanes: string[] }[] {
        return this.baseFlow ? flowRepos(this.baseFlow) : [];
    }
    isRepoCollapsed(id: string) {
        return !!this.collapse.repos?.includes(id);
    }
    toggleRepoBand(id: string) {
        const repos = this.collapse.repos || [];
        this.collapse = { ...this.collapse, repos: repos.includes(id) ? repos.filter((r) => r !== id) : [...repos, id] };
        this.saveCollapse();
    }
    /** A repo needs two or more boxes to be worth folding. */
    repoFoldable(id: string) {
        return this.bandMembers(id).length >= 2;
    }
    get collapsedCount() {
        return this.displayFlow?.nodes.filter((n) => n.collapsed).length || 0;
    }
    get layout() {
        const flow = this.displayFlow;
        return flow ? fitCaptions(layoutFlow(flow, { lanes: !this.compact })) : null;
    }
    private get collapseKey() {
        const t = this.trace;
        return t ? `${this.repo.namespace}flow-collapse:${t._doc || t.key || t.title}` : '';
    }
    private get shownKey() {
        const t = this.trace;
        return t ? `${this.repo.namespace}flow-shown:${t._doc || t.key || t.title}` : '';
    }
    /** The closer look for a box, or for the box a sub-box sits in. */
    expansionFor(id: string | null | undefined): { id: string; label: string; type: string; expansion: FlowExpansion } | null {
        if (!id || !this.trace?.expansions) return null;
        const box = id.split('.')[0];
        const expansion = this.trace.expansions[box];
        if (!expansion) return null;
        const node = this.trace.flow?.nodes.find((n) => n.id === box);
        return { id: box, label: node?.label || box, type: node?.type || 'process', expansion };
    }
    /** True for a box of the saved flow that may get a closer look (one level deep only). */
    canExpand(id: string | null | undefined) {
        return !!id && !!this.trace?.flow && expandable(this.trace.flow, id);
    }
    isShown(id: string) {
        return this.shown.includes(id);
    }
    /** Draw a box's closer look in the chart, or fold it back into its box. */
    setShown(id: string, show: boolean) {
        const exp = this.trace?.expansions?.[id];
        if (!exp || (show && exp.inline === false)) return;
        const was = this.selectedId;
        this.shown = show ? [...new Set([...this.shown, id])] : this.shown.filter((s) => s !== id);
        if (this.shownKey) this.deps.services.storage.set(this.shownKey, this.shown);
        // Keep the panel on the same closer look: the entry box when opening, the box when folding.
        if (show && was === id) this.select(exp.entry);
        else if (!show && was?.startsWith(id + '.')) this.select(id);
        this.saveCollapse();
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
        return (this.baseFlow?.nodes.filter((n) => n.lane === id).length || 0) >= 2;
    }
    isLaneCollapsed(id: string) {
        return this.collapse.lanes.includes(id);
    }
    toggleLane(id: string) {
        const lanes = this.isLaneCollapsed(id) ? this.collapse.lanes.filter((l) => l !== id) : [...this.collapse.lanes, id];
        this.collapse = { ...this.collapse, lanes };
        this.saveCollapse();
    }
    /**
     * Shift-click (or a click in select mode): add or remove a box from the selection.
     * The step open in the side panel joins as the first pick, and the panel then
     * shows the selection. Collapsed boxes can't be nested.
     */
    mark(id: string) {
        const node = this.displayFlow?.nodes.find((n) => n.id === id);
        if (!node || node.collapsed) return;
        if (this.marked.includes(id)) {
            this.marked = this.marked.filter((m) => m !== id);
            return;
        }
        const open = this.selected;
        const first = !this.marked.length && open && !open.collapsed && open.id !== id ? [open.id] : [];
        this.marked = [...this.marked, ...first, id];
        if (this.selectedId) this.select(null);
    }
    clearMarks() {
        this.marked = [];
    }
    /** Select mode: plain clicks add steps to the selection, for people without a Shift key. */
    toggleSelecting() {
        this.selecting = !this.selecting;
    }
    get markMode() {
        return this.selecting;
    }
    /** The side panel shows a step, a collapsed box, or the selection. */
    get panelOpen() {
        return !!this.selected || this.marked.length > 0;
    }
    /** Marked steps in pick order, with their labels. */
    get markedNodes() {
        const shown = this.displayFlow?.nodes || [];
        return this.marked.map((id) => shown.find((n) => n.id === id)).filter((n): n is NonNullable<typeof n> => !!n);
    }
    collapseMarked(label = '') {
        if (this.marked.length < 2) return;
        const taken = new Set(this.collapse.groups.map((g) => g.id));
        let n = this.collapse.groups.length + 1;
        while (taken.has(`s${n}`)) n++;
    /**
     * The box getting a closer look, for its spinner. A look drawn open in the chart
     * replaces its box, so its first step spins instead.
     */
    get busyNodes(): ReadonlySet<string> | undefined {
        const id = this.expandingId;
        if (!id) return undefined;
        const entry = this.shown.includes(id) ? this.trace?.expansions?.[id]?.entry : undefined;
        return new Set(entry ? [id, entry] : [id]);
    }
        const members = this.baseFlow?.nodes.map((node) => node.id).filter((id) => this.marked.includes(id)) || [];
        this.collapse = { ...this.collapse, groups: [...this.collapse.groups, { id: `s${n}`, label: label.trim(), members }] };
        this.marked = [];
        this.saveCollapse();
        this.select(`c:s${n}`);
    }
    /**
     * Unfold one collapsed box (by its drawn id), optionally selecting one of its steps.
     * Unfolding the open box selects its first step, so the selection doesn't vanish.
     * Returns the step selected, if any.
     */
    expand(collapsedId: string, select: string | null = null): string | null {
        if (!select && this.selectedId === collapsedId) select = this.members(collapsedId)[0]?.id || null;
        const id = collapsedId.replace(/^c:/, '');
        this.collapse = id.startsWith(LANE_GROUP)
            ? { ...this.collapse, lanes: this.collapse.lanes.filter((l) => l !== id.slice(LANE_GROUP.length)) }
            : id.startsWith(REPO_GROUP)
                ? { ...this.collapse, repos: (this.collapse.repos || []).filter((r) => r !== id.slice(REPO_GROUP.length)) }
                : { ...this.collapse, groups: this.collapse.groups.filter((g) => g.id !== id) };
        this.saveCollapse();
        // The step may still sit inside another folded box (a collapsed repo wins overlaps).
        if (select && !this.displayFlow?.nodes.some((n) => n.id === select)) select = null;
        if (select) this.select(select);
        else if (this.selectedId === collapsedId) this.select(null);
        return select;
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
    /** A group's own name, '' when it uses the default ("First step (+N more)"). */
    groupLabel(collapsedId: string) {
        const id = collapsedId.replace(/^c:/, '');
        return this.collapse.groups.find((g) => g.id === id)?.label || '';
    }
    /** True for named groups the reader made or accepted; lanes and repos keep their own name. */
    canRename(collapsedId: string) {
        return !collapsedId.startsWith('c:' + LANE_GROUP) && !collapsedId.startsWith('c:' + REPO_GROUP);
    }
    /** Hidden steps of a collapsed box, in flow order. */
    members(collapsedId: string) {
        const node = this.displayFlow?.nodes.find((n) => n.id === collapsedId);
        const ids = new Set(node?.members || []);
        return (this.baseFlow?.nodes || []).filter((n) => ids.has(n.id));
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
    /** What the zoom is fitted to: the trace, its flowchart and the layout, but not what is collapsed. */
    get fitKey() {
        const t = this.trace;
        if (!t?.flow) return '';
        return [t._doc || t.key || t.title, this.compact, t.flow.nodes.length, t.flow.edges.length].join('|');
    }
    /**
     * A small drawing of a closer look, for the side panel, with `selected` outlined. Its boxes
     * are buttons (see `openCloserStep`) only when the closer look can be drawn in the chart.
     */
    miniSvg(id: string, selected?: string | null) {
        const exp = this.trace?.expansions?.[id];
        if (!exp) return '';
        const layout = fitCaptions(layoutFlow({ nodes: exp.nodes, edges: exp.edges }, { lanes: false }));
        let svg = renderFlowSvg(layout, { title: 'Closer look' });
        if (exp.inline === false) svg = svg.replace(/ tabindex="0" role="button"/g, '');
        else svg = svg.replace(' role="img"', ' role="group"');
        const at = selected && exp.nodes.some((n) => n.id === selected) ? svg.indexOf(` data-id="${selected}"`) : -1;
        if (at > 0) {
            // Close the box's class attribute with " sel", as the chart marks its selection.
            const end = svg.lastIndexOf('"', at - 1);
            svg = svg.slice(0, end) + ' sel' + svg.slice(end);
        }
        return svg;
    }
    /** Select a closer look's step from its mini drawing, drawing the closer look in the chart first. */
    openCloserStep(box: string, step: string) {
        const exp = this.trace?.expansions?.[box];
        if (!exp || exp.inline === false || !exp.nodes.some((n) => n.id === step)) return;
        if (!this.isShown(box)) this.setShown(box, true);
        this.select(step);
    }
    get svg() {
        return this.layout ? renderFlowSvg(this.layout, { title: this.trace?.title }) : '';
    }
    get selected() {
        return this.displayFlow?.nodes.find((node) => node.id === this.selectedId) || null;
    }
    get references() {
        // A box inside a closer look has its own code; without any, its box's step code stands in.
        const own = this.selected?.expansion ? subRefs(this.trace?.expansions, this.selected.id) as Trace['refs'] : [];
        if (own.length) return own;
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
        return countInferred(this.baseFlow);
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
        return this.changeFor(this.selectedId);
    }
    /** Proposal status for a box, with the rationale from its linked architecture change. */
    changeFor(id: string | null): { status: ChangeStatus; rationale: string } | null {
        const node = id ? this.displayFlow?.nodes.find((n) => n.id === id) : null;
        if (!node || !this.trace || !hasChanges(this.trace)) return null;
        const stepId = node.step ? this.trace.steps[node.step - 1]?.id : null;
        const change = stepId ? this.trace.proposal?.nodes.find((n) => n.id === stepId) : undefined;
        const status = node.status || change?.status;
        return status ? { status, rationale: change?.rationale || '' } : null;
    }
    nodeLabel(id: string) {
        return this.displayFlow?.nodes.find((node) => node.id === id)?.label || id;
    }
    /** How a box is drawn, for its small shape on connection rows. */
    nodeShape(id: string): { type: string; inside: boolean; inferred: boolean; status?: ChangeStatus } {
        const node = this.displayFlow?.nodes.find((n) => n.id === id);
        return {
            type: node?.collapsed ? 'collapsed' : node?.type || 'process',
            // A step of a closer look drawn in the chart.
            inside: (this.expansionFor(id)?.id ?? id) !== id,
            inferred: !!node?.inferred,
            status: this.changeFor(id)?.status,
        };
    }
    /** Status for the diagram toolbar; closer-look jobs report beside their button instead. */
    get chartStatus() {
        return this.statusTarget === CHART ? this.status : '';
    }
    /** Status of the closer-look job for one box. */
    closerStatus(box: string) {
        return this.statusTarget === box ? this.status : '';
    }
    setSection(name: StepSection, open: boolean) {
        this.sections[name] = open;
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
        this.copy.reset();
        this.selectedId = null;
        this.marked = [];
        this.selecting = false;
        this.collapse = this.collapseKey ? readCollapse(this.deps.services.storage.get(this.collapseKey, null)) : emptyCollapse();
        this.shown = this.shownKey ? strings(this.deps.services.storage.get(this.shownKey, [])).filter((id) => !!this.trace?.expansions?.[id]) : [];
        this.expandingId = null;
        this.focus.reset();
        this.status = '';
        this.statusTarget = CHART;
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
        await this.run(CHART, '/api/flow', { trace }, (result, current) => {
            const flow = normalizeFlow(result.flow, current.steps.length) as Flow | null;
            if (!flow) throw new Error('The AI tool ended without a usable flowchart.');
            // A new drawing has new boxes: the old closer looks no longer fit.
            const updated = observable<Trace>({ ...current, flow, expansions: undefined, pendingFlow: false,
                outputs: { ...traceOutputs(current), flowchart: true } });
            this.shown = [];
            if (this.shownKey) this.deps.services.storage.set(this.shownKey, []);
            this.selectedId = null;
            return updated;
        });
    }
    /** Ask the AI tool for a closer look at one box, saved on the trace. */
    async lookCloser(id: string) {
        const trace = this.trace;
        if (this.disposed || this.busy || !trace?.flow || !this.canExpand(id)) return;
        this.expandingId = id;
        await this.run(id, '/api/flow/expand', { trace: plain(trace), node: id }, (result, current) => {
            const raw = result.expansion as Record<string, unknown> | undefined;
            const expansion = current.flow && normalizeExpansion({ ...raw, used: result.used, createdAt: Date.now() }, current.flow, id) as FlowExpansion | null;
            if (!expansion) throw new Error('The AI tool ended without usable steps.');
            const updated = observable<Trace>({ ...current, expansions: { ...current.expansions, [id]: expansion } });
            // Drawn open when its arrows fit; a panel-only answer folds an older one back.
            this.shown = expansion.inline ? [...new Set([...this.shown, id])] : this.shown.filter((s) => s !== id);
            if (this.shownKey) this.deps.services.storage.set(this.shownKey, this.shown);
            // The panel stays on this closer look: its first step when drawn open, else the box.
            if (this.selectedId === id || this.selectedId?.startsWith(id + '.')) this.select(expansion.inline ? expansion.entry : id);
            return updated;
        });
        runInAction(() => {
            this.expandingId = null;
        });
    }
    /** Delete a box's closer look from the trace. */
    async removeExpansion(id: string) {
        const trace = this.trace;
        if (this.busy || !trace?.expansions?.[id]) return;
        const expansions = { ...trace.expansions };
        delete expansions[id];
        if (this.selectedId?.startsWith(id + '.')) this.select(id);
        this.shown = this.shown.filter((s) => s !== id);
        if (this.shownKey) this.deps.services.storage.set(this.shownKey, this.shown);
        const updated = observable<Trace>({ ...trace, expansions: Object.keys(expansions).length ? expansions : undefined });
        this.trace = updated;
        this.saveCollapse();
        try {
            await this.deps.saveTrace(updated);
            this.deps.onTraceUpdated(updated);
        } catch (error) {
            runInAction(() => {
                this.error = true;
                this.statusTarget = id;
                this.status = error instanceof Error ? error.message : String(error);
            });
        }
    }
    /**
     * Stream one AI job for this trace, with progress at `target` (toolbar or a closer look). `apply`
     * turns the result into the updated trace (inside an action); it's then shown and saved.
     */
    private async run(target: string, path: string, body: Record<string, unknown>, apply: (result: StreamResult, trace: Trace) => Trace) {
        const trace = this.trace!;
        const controller = new AbortController();
        const revision = ++this.revision;
        const current = () =>
            !this.disposed && this.revision === revision && !controller.signal.aborted;
        this.controller = controller;
        this.busy = true;
        this.error = false;
        this.statusTarget = target;
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
                path,
                { ...body, ...this.deps.getPick() },
                controller.signal,
                (text) => {
                    progress = text;
                    tick();
                }
            );
            if (!current()) return;
            const updated = runInAction(() => {
                const next = apply(result, trace);
                this.trace = next;
                this.focus.reset();
                this.status = '';
                return next;
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
            this.copy.flash();
        } catch {
            if (!this.disposed && revision === this.revision && !this.busy)
                runInAction(() => {
                    this.statusTarget = CHART;
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
        this.copy.dispose();
    }
}

export type Workspace = 'architecture' | 'flowchart' | 'sitemap';
export type ChangeStatus = 'new' | 'modified' | 'removed';
export interface MapNode {
    id: string;
    group: string;
    kind: string;
    title?: string;
    tag?: string;
    desc?: string;
    path?: string;
    facts?: string[];
    /** Contract keys (lib/contracts.mjs): what this node serves to, and calls in, other repos. */
    provides?: string[];
    consumes?: string[];
    status?: ChangeStatus;
    rationale?: string;
    suggestedPath?: string;
    /** Workspace view: the repo this card comes from ('home' for this one). */
    repo?: string;
    /** Workspace view: a card standing in for a collapsed repo; `members` are the hidden card ids. */
    collapsed?: boolean;
    members?: string[];
}
export interface MapEdge {
    from: string;
    to: string;
    type: string;
    label?: string;
    inferred?: boolean;
    status?: ChangeStatus;
    rationale?: string;
    /** Workspace view: a connection between two repos, and how it was found. */
    seam?: SeamVia;
    keys?: string[];
    why?: string;
    refs?: CodeRef[];
    merged?: number;
}
export interface MapGroup {
    id: string;
    col: number;
    title: string;
    open?: boolean;
    note?: string;
    repo?: string;
}
export type SeamVia = 'contract' | 'ai' | 'manual';
/** A connection between repos, as stored in workspace.json (or found by contract). */
export interface Seam {
    from: string;
    to: string;
    type: string;
    via: SeamVia;
    label?: string;
    why?: string;
    keys?: string[];
    refs?: CodeRef[];
}
export interface WorkspaceLink {
    name: string;
    dir?: string;
    snapshot?: string;
}
export interface WorkspaceFile {
    links: WorkspaceLink[];
    seams: Seam[];
}
export interface CheckoutFreshness {
    map: { state: string; commit: string | null; changed: number; commitsSince: number };
    remote: { state: string; branch?: string; ahead?: number; behind?: number; fetchedAt?: string | null };
}
export interface SnapshotFreshness {
    snapshot: { state: string; exportedAt: string | null; commit: string | null; latest?: string; checkedAt?: string };
}
export interface WorkspaceRepo {
    name: string;
    title: string;
    source: 'home' | 'dir' | 'snapshot';
    readable: boolean;
    dir?: string;
    snapshot?: { file: string; remote?: string; commit?: string; exportedAt?: string };
    error?: string;
    /** Turned off by this person: kept in workspace.json, left out of the workspace. */
    off?: boolean;
    freshness?: Partial<CheckoutFreshness> & Partial<SnapshotFreshness>;
}
export interface WorkspaceView {
    workspace: WorkspaceFile;
    repos: WorkspaceRepo[];
    map: RepoMap & { repos: { name: string; title: string; count: number }[]; seams: Seam[]; replaced: Record<string, string> };
}
export interface RepoMap {
    nodes: MapNode[];
    edges: MapEdge[];
    groups: MapGroup[];
    commit?: string;
}
export interface CodeRef {
    path: string;
    start: number;
    end: number;
    why?: string;
    step?: string;
    title?: string;
    kind?: string;
    /** Read at this commit (a review's head), not from the checkout. */
    rev?: string;
    /** Show this file's diff between two commits (head '' = the working tree) instead of its lines. */
    diff?: { base: string; head: string };
}
/** A changed file in a review, with the cards it belongs to. */
export interface ReviewFile {
    path: string;
    status: string;
    from?: string;
    additions: number;
    deletions: number;
    cards: string[];
    note: string;
}
/** What a review compared, and what it found beyond the map changes. */
export interface Review {
    kind: 'pr' | 'refs' | 'local';
    base: string;
    head: string;
    headRef?: string;
    baseSha: string;
    headSha: string;
    mergeBase: string;
    number?: number;
    url?: string;
    dirty?: boolean;
    fingerprint?: string;
    risks: string[];
    questions: string[];
    files: ReviewFile[];
    skipped: string[];
}
/** What to review: a pull request, two refs, or local changes. */
export interface ReviewRequest {
    pr?: string;
    base?: string;
    head?: string;
    local?: boolean;
}
export interface Proposal {
    rationale: string;
    assumptions: string[];
    questions: string[];
    nodes: MapNode[];
    edges: MapEdge[];
}
export interface Plan {
    summary: string;
    tasks: { title: string; detail: string; files: string[] }[];
    interfaces: string[];
    tests: string[];
    risks: string[];
    questions: string[];
}
export interface FlowNode {
    id: string;
    type: string;
    label: string;
    detail?: string;
    step?: number;
    inferred?: boolean;
    status?: ChangeStatus;
    lane?: string;
    /** Set on a box standing in for a collapsed group; `members` are the hidden box ids. */
    collapsed?: boolean;
    members?: string[];
    /** Drawn inside an expanded box: that box's id. */
    expansion?: string;
    /** Has a saved closer look that isn't drawn in the chart right now. */
    expandable?: boolean;
    /** A sub-box's own code, in a saved expansion. */
    refs?: CodeRef[];
}
/** A closer look at one flowchart box (lib/flow-expand.mjs). */
export interface FlowExpansion {
    summary: string;
    gaps: string;
    nodes: FlowNode[];
    edges: Flow['edges'];
    entry: string;
    exits: { to: string; from: string }[];
    /** False when its arrows couldn't all be matched: shown in the side panel only. */
    inline: boolean;
    used?: Trace['used'];
    createdAt?: number;
}
/** A group of boxes shown as one box. */
export interface CollapseGroup {
    id: string;
    label: string;
    members: string[];
}
export interface Flow {
    /** `repo` ("home" or a link name) on workspace traces. */
    lanes?: { id: string; label: string; repo?: string }[];
    /** Repos whose lanes are drawn inside one band each (workspace traces). */
    repos?: { id: string; label: string }[];
    nodes: FlowNode[];
    /** Boxes drawn open, with their labels (set by expandFlow). */
    expanded?: { id: string; label: string }[];
    edges: {
        from: string;
        to: string;
        label?: string;
        inferred?: boolean;
        status?: ChangeStatus;
    }[];
}
export interface SitemapScreen {
    id: string;
    app: string;
    label: string;
    route: string;
    detail: string;
    refs: CodeRef[];
}
export interface SitemapNavigation {
    from: string;
    to: string;
    label: string;
    condition: string;
    refs: CodeRef[];
}
export interface Sitemap {
    version: number;
    applicability: 'applicable' | 'none' | 'incomplete';
    summary: string;
    applications: { id: string; label: string }[];
    screens: SitemapScreen[];
    navigation: SitemapNavigation[];
    gaps: string[];
    commit?: string;
    generatedAt?: string;
    dirtyAtGeneration?: boolean;
}
export interface SitemapResult {
    sitemap: Sitemap | null;
    status: { state: string; dirty?: boolean; dirtyAtGeneration?: boolean };
}
export interface SitemapTrace {
    version: number;
    base: Sitemap;
    applicability: 'relevant' | 'none';
    summary: string;
    gaps: string[];
    steps: { screen: string; note: string; refs: CodeRef[] }[];
    navigation: number[];
    changes: {
        screens: (SitemapScreen & { status: ChangeStatus; rationale: string })[];
        navigation: (SitemapNavigation & { index?: number; status: ChangeStatus; rationale: string })[];
    };
}
export interface Trace {
    intent: 'description' | 'proposal' | 'review';
    title: string;
    prompt: string;
    summary: string;
    gaps: string;
    steps: { id: string; note: string }[];
    edges: string[][];
    refs: CodeRef[];
    outputs: { architecture: boolean; flowchart: boolean; sitemap?: boolean };
    pendingFlow: boolean;
    pendingSitemap?: boolean;
    sitemap?: SitemapTrace | null;
    flow?: Flow | null;
    /** Closer looks at flowchart boxes, by box id. */
    expansions?: Record<string, FlowExpansion>;
    proposal?: Proposal | null;
    plan?: Plan | null;
    /** Set on reviews of a code change (intent 'review'). */
    review?: Review | null;
    used?: { agent: string; model: string; effort: string; label: string } | null;
    /** Traced over the workspace: step ids and refs may carry a `<name>:` prefix. */
    scope?: 'workspace';
    /** Repos the workspace had when traced ("home" plus link names). */
    repos?: string[];
    _doc?: string;
    key?: string;
    createdAt?: number;
    pairs?: Set<string>;
}
export interface AgentPick {
    agent?: string;
    model?: string;
    effort?: string;
}
export interface Agent {
    id: string;
    label: string;
    available: boolean;
    reason?: string;
    defaultModel: string;
    models: { id: string; label?: string; efforts?: string[] }[];
    efforts: string[];
}
export interface AgentData {
    agents: Agent[];
    default?: AgentPick;
    generate?: AgentPick | null;
    off?: boolean;
}
export interface RepoConfig {
    name: string;
    repo?: string;
    columns: { title: string; subtitle?: string }[];
    kinds?: Record<string, string>;
    labels?: Record<string, string>;
    [key: string]: unknown;
}
export interface RepoInfo {
    branch?: string;
    sha?: string;
    dirty?: boolean;
    github?: string;
    ghBase?: string;
    ghRef?: string;
    exact?: boolean;
}
export interface Bootstrap {
    config: RepoConfig;
    repo: RepoInfo;
    ai: { available: boolean; label: string; reason?: string };
}
export interface FileContent {
    path: string;
    start: number;
    end: number;
    lines: string[];
    total?: number;
    text?: string;
    /** Diff lines (unified format) rather than file lines. */
    diff?: boolean;
}
export interface StreamResult {
    type?: string;
    trace?: unknown;
    flow?: unknown;
    plan?: unknown;
    used?: Trace['used'];
    cost?: number;
    tokens?: number;
    [key: string]: unknown;
}

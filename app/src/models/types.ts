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
    status?: ChangeStatus;
    rationale?: string;
    suggestedPath?: string;
}
export interface MapEdge {
    from: string;
    to: string;
    type: string;
    label?: string;
    inferred?: boolean;
    status?: ChangeStatus;
    rationale?: string;
}
export interface MapGroup {
    id: string;
    col: number;
    title: string;
    open?: boolean;
    note?: string;
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
}
export interface Flow {
    lanes?: { id: string; label: string }[];
    nodes: FlowNode[];
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
    intent: 'description' | 'proposal';
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
    proposal?: Proposal | null;
    plan?: Plan | null;
    used?: { agent: string; model: string; effort: string; label: string } | null;
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

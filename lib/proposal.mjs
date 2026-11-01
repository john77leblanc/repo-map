/** Trace-local proposals, shared by the server and browser. Never edits the map. */
const CHANGE_LABELS = { new: 'New', modified: 'Modified', removed: 'Removed' };
const text = (value, limit = 2000) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const list = (value) => (Array.isArray(value) ? value : []).slice(0, 20).map((v) => text(v)).filter(Boolean);
const changeStatus = (value) => typeof value === 'string' && Object.hasOwn(CHANGE_LABELS, value) ? value : '';
const proposedId = (value) => /^proposal:[a-z0-9_-]{1,64}$/i.test(value);
// The plan window draws each step's number, so a "Step 2:" / "2." the model adds is dropped.
const STEP_PREFIX = /^(?:step\s*)?\d+\s*[.):\-–—]\s*/i;

function normalizePlan(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const tasks = (Array.isArray(raw.tasks) ? raw.tasks : []).slice(0, 30).map((t) => ({
        title: text(t?.title, 160).replace(STEP_PREFIX, ''), detail: text(t?.detail, 4000), files: list(t?.files),
        ...(t?.done === true ? { done: true } : {}),
    })).filter((t) => t.title && t.detail);
    if (!tasks.length) return null;
    return { summary: text(raw.summary, 4000), tasks, interfaces: list(raw.interfaces), tests: list(raw.tests), risks: list(raw.risks), questions: list(raw.questions) };
}

function normalizeProposal(raw, map) {
    if (!raw || typeof raw !== 'object') raw = {};
    const existing = new Map(map.nodes.map((n) => [n.id, n]));
    const groups = new Set(map.groups.map((g) => g.id));
    const nodes = [], seen = new Set();
    for (const n of (Array.isArray(raw.nodes) ? raw.nodes : []).slice(0, 40)) {
        if (!n || typeof n !== 'object') continue;
        const id = text(n.id, 80), status = changeStatus(n.status), base = existing.get(id);
        if (!status || seen.has(id)) continue;
        if (base ? status === 'new' : status !== 'new' || !proposedId(id) || !groups.has(n.group)) continue;
        const title = text(n.title, 100) || base?.title || id;
        nodes.push({ id, status, title, group: base?.group || n.group,
            kind: base?.kind || (['service', 'topic', 'external'].includes(n.kind) ? n.kind : 'service'),
            rationale: text(n.rationale), suggestedPath: text(n.suggestedPath, 300) });
        seen.add(id);
    }
    const ids = new Set([...existing.keys(), ...nodes.map((n) => n.id)]);
    const original = new Map(map.edges.map((e) => [`${e.from}|${e.to}`, e]));
    const edges = [], pairs = new Set();
    for (const e of (Array.isArray(raw.edges) ? raw.edges : []).slice(0, 80)) {
        if (!e || typeof e !== 'object') continue;
        const from = text(e.from, 80), to = text(e.to, 80), status = changeStatus(e.status), key = `${from}|${to}`;
        if (!status || !ids.has(from) || !ids.has(to) || from === to || pairs.has(key)) continue;
        if (status === 'new' ? original.has(key) : !original.has(key)) continue;
        edges.push({ from, to, status, type: ['http', 'event', 'sync'].includes(e.type) ? e.type : original.get(key)?.type || 'http',
            label: text(typeof e.label === 'string' ? e.label : original.get(key)?.label, 100), rationale: text(e.rationale) });
        pairs.add(key);
    }
    return { rationale: text(raw.rationale, 6000), assumptions: list(raw.assumptions), questions: list(raw.questions), nodes, edges };
}

/** Compose a disposable view; both the input map and proposal remain unchanged. */
function proposalMap(map, proposal) {
    const changes = new Map(proposal.nodes.map((n) => [n.id, n]));
    const connections = new Map(proposal.edges.map((e) => [`${e.from}|${e.to}`, e]));
    return { ...map,
        nodes: [...map.nodes.map((n) => ({ ...n, ...changes.get(n.id) })), ...proposal.nodes.filter((n) => n.status === 'new')],
        edges: [...map.edges.map((e) => ({ ...e, ...connections.get(`${e.from}|${e.to}`) })), ...proposal.edges.filter((e) => e.status === 'new')],
    };
}

export { CHANGE_LABELS, changeStatus, normalizePlan, normalizeProposal, proposalMap };

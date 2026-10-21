/**
 * Flowcharts that accompany a trace: the process's logic (what the person does,
 * what the system does, the decisions and outcomes), as boxes and arrows.
 *
 *   { nodes: [{ id, type, label, detail?, step?, inferred? }],
 *     edges: [{ from, to, label?, inferred? }] }
 *
 * `step` is the 1-based index of the trace step whose code holds that logic.
 */

const FLOW_TYPES = ['start', 'end', 'action', 'process', 'decision', 'error'];
const MAX_NODES = 40;
const MAX_EDGES = 80;

const str = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * Clean a flow from an AI tool or a shared trace code. Unknown types become
 * "process", ids are made unique, edges to missing boxes are dropped.
 * Returns null when nothing drawable is left.
 */
function normalizeFlow(raw, stepCount = Infinity) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.nodes)) {
        return null;
    }
    const ids = new Map();
    const taken = new Set();
    const nodes = [];
    for (const n of raw.nodes.slice(0, MAX_NODES)) {
        if (!n || typeof n !== 'object') {
            continue;
        }
        const label = str(n.label, 90);
        if (!label) {
            continue;
        }
        const rawId = str(n.id, 40);
        let id = rawId.replace(/[^\w-]/g, '') || `n${nodes.length + 1}`;
        while (taken.has(id)) {
            id = `${id}-${nodes.length + 1}`;
        }
        taken.add(id);
        const step = parseInt(n.step, 10);
        const node = { id, type: FLOW_TYPES.includes(n.type) ? n.type : 'process', label };
        const detail = str(n.detail, 400);
        if (detail) {
            node.detail = detail;
        }
        if (step >= 1 && step <= stepCount) {
            node.step = step;
        }
        if (n.inferred === true) {
            node.inferred = true;
        }
        // edges refer to the id the tool wrote; the first box with that id wins
        if (rawId && !ids.has(rawId)) {
            ids.set(rawId, id);
        }
        if (!ids.has(id)) {
            ids.set(id, id);
        }
        nodes.push(node);
    }
    if (nodes.length < 2) {
        return null;
    }
    const seen = new Set();
    const edges = [];
    for (const e of Array.isArray(raw.edges) ? raw.edges : []) {
        if (edges.length >= MAX_EDGES) {
            break;
        }
        const from = ids.get(str(e && e.from, 40));
        const to = ids.get(str(e && e.to, 40));
        if (!from || !to || from === to || seen.has(`${from}>${to}`)) {
            continue;
        }
        seen.add(`${from}>${to}`);
        const edge = { from, to };
        const label = str(e.label, 40);
        if (label) {
            edge.label = label;
        }
        if (e.inferred === true) {
            edge.inferred = true;
        }
        edges.push(edge);
    }
    if (!edges.length) {
        return null;
    }
    return { nodes, edges };
}

/** Mermaid source for pasting into GitHub, GitLab, Notion and other Markdown tools. */
function flowToMermaid(flow, title = '') {
    const q = (s) => `"${String(s).replace(/"/g, '#quot;')}"`;
    const shape = {
        start: (l) => `([${q(l)}])`,
        end: (l) => `([${q(l)}])`,
        action: (l) => `[/${q(l)}/]`,
        process: (l) => `[${q(l)}]`,
        decision: (l) => `{${q(l)}}`,
        error: (l) => `[[${q(l)}]]`,
    };
    const mid = new Map(flow.nodes.map((n, i) => [n.id, `n${i + 1}`]));
    const lines = [];
    if (title) {
        lines.push('---', `title: ${String(title).replace(/[\r\n]/g, ' ')}`, '---');
    }
    lines.push('flowchart TD');
    for (const n of flow.nodes) {
        lines.push(`    ${mid.get(n.id)}${(shape[n.type] || shape.process)(n.label)}`);
    }
    for (const e of flow.edges) {
        const arrow = e.inferred ? '-.->' : '-->';
        const label = e.label ? `|${q(e.label)}|` : '';
        lines.push(`    ${mid.get(e.from)} ${arrow}${label} ${mid.get(e.to)}`);
    }
    const errors = flow.nodes.filter((n) => n.type === 'error').map((n) => mid.get(n.id));
    if (errors.length) {
        lines.push('    classDef err stroke:#c0392b,stroke-width:2px', `    class ${errors.join(',')} err`);
    }
    return lines.join('\n');
}

export { FLOW_TYPES, flowToMermaid, normalizeFlow };

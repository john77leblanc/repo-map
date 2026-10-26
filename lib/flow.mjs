/**
 * Flowcharts that accompany a trace: the process's logic (what the person does,
 * what the system does, the decisions and outcomes), as boxes and arrows.
 *
 *   { nodes: [{ id, type, label, detail?, step?, inferred? }],
 *     edges: [{ from, to, label?, inferred? }],
 *     chunks?: [{ id, label, nodes: [id, ...] }] }
 *
 * `chunks` are AI-suggested sub-processes a reader can collapse into one box.
 *
 * `step` is the 1-based index of the trace step whose code holds that logic.
 */

import { CHANGE_LABELS, changeStatus } from './proposal.mjs';

const FLOW_TYPES = ['start', 'end', 'action', 'process', 'decision', 'error'];
const MAX_NODES = 40;
const MAX_EDGES = 80;
const MAX_CHUNKS = 10;

const str = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Only participants actually used by nodes; missing ownership stays explicit. */
function flowLanes(flow) {
    const used = new Set(flow.nodes.map((n) => n.lane));
    const lanes = (flow.lanes || []).filter((lane) => used.has(lane.id));
    if (lanes.length && flow.nodes.some((n) => !lanes.some((lane) => lane.id === n.lane))) {
        lanes.push({ id: '', label: 'Unassigned' });
    }
    return lanes;
}

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
    const lanes = [];
    const laneIds = new Set();
    for (const lane of (Array.isArray(raw.lanes) ? raw.lanes : []).slice(0, 12)) {
        const id = str(lane?.id, 40);
        const label = str(lane?.label, 60);
        if (!/^[\w-]+$/.test(id) || !label || laneIds.has(id)) continue;
        lanes.push({ id, label });
        laneIds.add(id);
    }
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
        if (laneIds.has(n.lane)) node.lane = n.lane;
        if (changeStatus(n.status)) node.status = n.status;
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
        if (changeStatus(e.status)) edge.status = e.status;
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
    const usedLanes = lanes.filter((lane) => nodes.some((n) => n.lane === lane.id));
    const chunks = normalizeChunks(raw.chunks, ids, nodes.length);
    return { nodes, edges, ...(usedLanes.length ? { lanes: usedLanes } : {}), ...(chunks.length ? { chunks } : {}) };
}

/** Suggested sub-processes: known boxes only, two or more each, never overlapping, never the whole chart. */
function normalizeChunks(raw, ids, total) {
    const taken = new Set();
    const chunks = [];
    for (const c of (Array.isArray(raw) ? raw : [])) {
        if (chunks.length >= MAX_CHUNKS) break;
        const label = str(c?.label, 60);
        if (!label || !Array.isArray(c.nodes)) continue;
        const all = [...new Set(c.nodes.map((id) => ids.get(str(id, 40))).filter(Boolean))];
        const nodes = all.filter((id) => !taken.has(id));
        if (nodes.length < 2 || all.length >= total) continue;
        nodes.forEach((id) => taken.add(id));
        chunks.push({ id: `k${chunks.length + 1}`, label, nodes });
    }
    return chunks;
}

/** How many nodes and edges the AI marked as inferred. */
function countInferred(flow) {
    if (!flow) return 0;
    return (flow.nodes || []).filter((n) => n.inferred).length + (flow.edges || []).filter((e) => e.inferred).length;
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
    const emitNode = (n) => {
        const label = CHANGE_LABELS[n.status] ? `[${CHANGE_LABELS[n.status]}] ${n.label}` : n.label;
        lines.push(`    ${mid.get(n.id)}${(shape[n.type] || shape.process)(label)}`);
    };
    const lanes = flowLanes(flow);
    if (lanes.length) {
        lanes.forEach((lane, i) => {
            lines.push(`    subgraph lane${i + 1}[${q(lane.label)}]`);
            flow.nodes.filter((n) => (n.lane || '') === lane.id).forEach(emitNode);
            lines.push('    end');
        });
    } else {
        flow.nodes.forEach(emitNode);
    }
    for (const e of flow.edges) {
        const arrow = e.inferred || e.status === 'new' ? '-.->' : '-->';
        const caption = [CHANGE_LABELS[e.status], e.label].filter(Boolean).join(': ');
        const label = caption ? `|${q(caption)}|` : '';
        lines.push(`    ${mid.get(e.from)} ${arrow}${label} ${mid.get(e.to)}`);
    }
    const errors = flow.nodes.filter((n) => n.type === 'error').map((n) => mid.get(n.id));
    if (errors.length) {
        lines.push('    classDef err stroke:#c0392b,stroke-width:2px', `    class ${errors.join(',')} err`);
    }
    for (const [status, style] of Object.entries({ new: 'stroke:#246b52,stroke-dasharray:8 4', modified: 'stroke:#a25c12,stroke-width:3px', removed: 'stroke:#777,color:#777,stroke-dasharray:2 4' })) {
        const ids = flow.nodes.filter((n) => n.status === status).map((n) => mid.get(n.id));
        if (ids.length) lines.push(`    classDef ${status} ${style}`, `    class ${ids.join(',')} ${status}`);
    }
    return lines.join('\n');
}

export { FLOW_TYPES, countInferred, flowLanes, flowToMermaid, normalizeFlow };

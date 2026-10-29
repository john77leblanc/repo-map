/**
 * Expansions: one flowchart box opened up into the smaller steps inside it.
 * Pure and browser-safe. One level only: boxes inside an expansion can't be expanded.
 *
 *   trace.expansions = { [boxId]: {
 *       summary, gaps,
 *       nodes: [{ id: '<boxId>.1', type, label, detail?, lane?, status?, inferred?, refs? }],
 *       edges: [{ from, to, label?, inferred?, status? }],   // between the sub-boxes
 *       entry,                                                // where arrows into the box now land
 *       exits: [{ to, from }],                                // per arrow leaving the box (by its target): the sub-box it leaves from
 *       inline,                                               // false when the arrows couldn't all be matched: panel only
 *       used?, createdAt?,
 *   } }
 *
 * The AI names exits by arrow number ({ arrow: n, from }), counted over the box's
 * outgoing arrows in flow order; saved expansions name them by target ({ to, from }).
 */

import { FLOW_TYPES } from './flow.mjs';
import { changeStatus } from './proposal.mjs';

const MAX_SUB_NODES = 12;
const MAX_SUB_EDGES = 30;
const MAX_REFS = 2;

const str = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** A box that can be expanded: a real box of the saved flow, not one inside an expansion or a collapsed group. */
function expandable(flow, id) {
    const node = (flow?.nodes || []).find((n) => n.id === id);
    return !!node && !node.collapsed && !node.expansion && !String(id).includes('.');
}

/** Arrows leaving a box, in flow order (the order the AI numbers them in). */
function exitArrows(flow, id) {
    return (flow?.edges || []).filter((e) => e.from === id);
}

function cleanRefs(raw) {
    const out = [];
    for (const r of Array.isArray(raw) ? raw : []) {
        if (out.length >= MAX_REFS || !isObject(r)) continue;
        const path = str(r.path, 300);
        const start = parseInt(r.start, 10);
        const end = parseInt(r.end, 10);
        if (!path || !(start >= 1)) continue;
        const ref = { path, start, end: end >= start ? end : start };
        const why = str(r.why, 300);
        if (why) ref.why = why;
        // a review's refs are read at its head commit
        if (/^[0-9a-f]{7,40}$/i.test(String(r.rev || ''))) ref.rev = String(r.rev).toLowerCase();
        out.push(ref);
    }
    return out;
}

/**
 * Clean an expansion from an AI tool or a saved trace, against the flow it belongs to.
 * Returns null when the box can't be expanded or fewer than two sub-boxes are left.
 */
function normalizeExpansion(raw, flow, id) {
    if (!isObject(raw) || !Array.isArray(raw.nodes) || !expandable(flow, id)) return null;
    const parent = flow.nodes.find((n) => n.id === id);
    const lanes = new Set((flow.lanes || []).map((l) => l.id));
    const ids = new Map();
    const nodes = [];
    for (const n of raw.nodes) {
        if (nodes.length >= MAX_SUB_NODES || !isObject(n)) continue;
        const label = str(n.label, 90);
        if (!label) continue;
        const sub = `${id}.${nodes.length + 1}`;
        const rawId = str(n.id, 60);
        if (rawId && !ids.has(rawId)) ids.set(rawId, sub);
        ids.set(sub, sub);
        // There is only one start, and it's the whole flow's.
        const type = FLOW_TYPES.includes(n.type) && n.type !== 'start' ? n.type : 'process';
        const node = { id: sub, type, label };
        const detail = str(n.detail, 400);
        if (detail) node.detail = detail;
        const lane = lanes.has(n.lane) ? n.lane : parent.lane;
        if (lane) node.lane = lane;
        if (changeStatus(n.status)) node.status = n.status;
        if (n.inferred === true) node.inferred = true;
        const refs = cleanRefs(n.refs);
        if (refs.length) node.refs = refs;
        nodes.push(node);
    }
    if (nodes.length < 2) return null;
    const seen = new Set();
    const edges = [];
    for (const e of Array.isArray(raw.edges) ? raw.edges : []) {
        if (edges.length >= MAX_SUB_EDGES || !isObject(e)) continue;
        const from = ids.get(str(e.from, 60));
        const to = ids.get(str(e.to, 60));
        if (!from || !to || from === to || seen.has(`${from}>${to}`)) continue;
        seen.add(`${from}>${to}`);
        const edge = { from, to };
        const label = str(e.label, 40);
        if (label) edge.label = label;
        if (changeStatus(e.status)) edge.status = e.status;
        if (e.inferred === true) edge.inferred = true;
        edges.push(edge);
    }
    const entry = ids.get(str(raw.entry, 60)) || nodes[0].id;
    const arrows = exitArrows(flow, id);
    const exits = [];
    for (const x of Array.isArray(raw.exits) ? raw.exits : []) {
        if (!isObject(x)) continue;
        const from = ids.get(str(x.from, 60));
        const arrow = x.to !== undefined ? arrows.find((a) => a.to === x.to) : arrows[parseInt(x.arrow, 10) - 1];
        if (from && arrow && !exits.some((e) => e.to === arrow.to)) exits.push({ to: arrow.to, from });
    }
    // An unmatched arrow can still leave from the one sub-box that leads nowhere.
    const sinks = nodes.filter((n) => !edges.some((e) => e.from === n.id) && n.type !== 'error' && n.type !== 'end');
    for (const a of arrows) {
        if (!exits.some((e) => e.to === a.to) && sinks.length === 1) exits.push({ to: a.to, from: sinks[0].id });
    }
    const out = {
        summary: str(raw.summary, 1200),
        gaps: str(raw.gaps, 800),
        nodes,
        edges,
        entry,
        exits: arrows.map((a) => exits.find((e) => e.to === a.to)).filter(Boolean),
        inline: arrows.every((a) => exits.some((e) => e.to === a.to)),
    };
    if (isObject(raw.used)) out.used = { agent: str(raw.used.agent, 40), model: str(raw.used.model, 120), effort: str(raw.used.effort, 32), label: str(raw.used.label, 160) };
    if (Number.isFinite(raw.createdAt)) out.createdAt = raw.createdAt;
    return out;
}

/** Saved expansions, cleaned against the trace's flow; undefined when none are usable. */
function normalizeExpansions(raw, flow) {
    if (!isObject(raw) || !flow) return undefined;
    const out = {};
    for (const [id, value] of Object.entries(raw).slice(0, 40)) {
        const exp = normalizeExpansion(value, flow, id);
        if (exp) out[id] = exp;
    }
    return Object.keys(out).length ? out : undefined;
}

/**
 * The flow with the `shown` expansions drawn in place of their boxes. Sub-boxes
 * carry `expansion` (their box's id) and that box's `step`; arrows into the box
 * land on its entry and arrows out leave from the matching exit. The result lists
 * the boxes drawn open in `expanded: [{ id, label }]`. Boxes whose expansion is
 * panel-only (`inline: false`) stay as they are.
 */
function expandFlow(flow, expansions, shown = []) {
    if (!flow) return flow;
    const open = new Map();
    for (const id of shown) {
        const exp = expansions?.[id];
        if (exp && exp.inline !== false && expandable(flow, id)) open.set(id, exp);
    }
    const marked = (n) => (expansions?.[n.id] && !open.has(n.id) ? { ...n, expandable: true } : n);
    if (!open.size) return expansions ? { ...flow, nodes: flow.nodes.map(marked) } : flow;
    const nodes = [];
    for (const n of flow.nodes) {
        const exp = open.get(n.id);
        if (!exp) {
            nodes.push(marked(n));
            continue;
        }
        for (const sub of exp.nodes) {
            const node = { ...sub, expansion: n.id };
            delete node.refs;
            if (n.step) node.step = n.step;
            nodes.push(node);
        }
    }
    const edges = [];
    const seen = new Set();
    const add = (e) => {
        const key = `${e.from}>${e.to}`;
        if (e.from === e.to || seen.has(key)) return;
        seen.add(key);
        edges.push(e);
    };
    for (const e of flow.edges) {
        const out = open.get(e.from);
        const into = open.get(e.to);
        if (!out && !into) {
            add(e);
            continue;
        }
        add({ ...e, from: out ? out.exits.find((x) => x.to === e.to)?.from || out.nodes.at(-1).id : e.from, to: into ? into.entry : e.to });
    }
    for (const exp of open.values()) exp.edges.forEach((e) => add(e));
    return {
        ...flow,
        nodes,
        edges,
        expanded: [...open.keys()].map((id) => ({ id, label: flow.nodes.find((n) => n.id === id).label })),
    };
}

/** The sub-box's code refs, from the expansion it belongs to. */
function subRefs(expansions, id) {
    const parent = String(id).split('.')[0];
    return expansions?.[parent]?.nodes.find((n) => n.id === id)?.refs || [];
}

export { exitArrows, expandFlow, expandable, normalizeExpansion, normalizeExpansions, subRefs };

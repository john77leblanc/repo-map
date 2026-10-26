/**
 * Collapse groups of boxes into one box, for flowcharts and maps alike.
 * Pure and browser-safe; the input graph is never changed.
 *
 *   collapseGraph({ nodes, edges }, [{ id, label, members: [nodeId, ...] }])
 *     -> { ...graph, nodes, edges }
 *
 * Each group becomes one node `{ id: 'c:<id>', type: 'collapsed', collapsed: true,
 * label, members }`, placed where its first member was. Edges into or out of
 * members are rewired to it; edges inside a group disappear; parallel edges
 * merge, joining their labels.
 */

const MAX_LABELS = 3;
const COLLAPSED_PREFIX = 'c:';

/** Groups that can be drawn: known members, at least two, no member in two groups (first wins). */
function usableGroups(nodes, groups) {
    const known = new Set(nodes.map((n) => n.id));
    const taken = new Set();
    const ids = new Set();
    const out = [];
    for (const g of Array.isArray(groups) ? groups : []) {
        if (!g || typeof g !== 'object' || !g.id || ids.has(g.id)) continue;
        const members = [...new Set(Array.isArray(g.members) ? g.members : [])].filter((id) => known.has(id) && !taken.has(id));
        if (members.length < 2) continue;
        members.forEach((id) => taken.add(id));
        ids.add(g.id);
        out.push({ id: String(g.id), label: String(g.label || '').trim(), members });
    }
    return out;
}

function mergeLabels(labels) {
    const unique = [...new Set(labels.filter(Boolean))];
    if (unique.length <= MAX_LABELS) return unique.join(' / ');
    return `${unique.slice(0, MAX_LABELS).join(' / ')} +${unique.length - MAX_LABELS}`;
}

function collapseGraph(graph, groups) {
    const nodes = graph?.nodes || [];
    const edges = graph?.edges || [];
    const usable = usableGroups(nodes, groups);
    if (!usable.length) return { ...graph, nodes: [...nodes], edges: [...edges] };
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const owner = new Map();
    const collapsed = new Map();
    for (const g of usable) {
        const id = COLLAPSED_PREFIX + g.id;
        const members = g.members.map((m) => byId.get(m));
        const lanes = new Set(members.map((m) => m.lane || ''));
        const statuses = members.map((m) => m.status).filter(Boolean);
        const node = {
            id,
            type: 'collapsed',
            collapsed: true,
            label: g.label || `${members[0].label || members[0].title || members[0].id} (+${members.length - 1} more)`,
            members: g.members,
        };
        if (lanes.size === 1 && members[0].lane) node.lane = members[0].lane;
        if (members[0].group !== undefined && members.every((m) => m.group === members[0].group)) node.group = members[0].group;
        if (statuses.length) node.status = statuses.every((s) => s === 'new') && statuses.length === members.length ? 'new' : 'modified';
        if (members.every((m) => m.inferred)) node.inferred = true;
        g.members.forEach((m) => owner.set(m, id));
        collapsed.set(id, node);
    }
    const placed = new Set();
    const outNodes = [];
    for (const n of nodes) {
        const own = owner.get(n.id);
        if (!own) outNodes.push(n);
        else if (!placed.has(own)) {
            placed.add(own);
            outNodes.push(collapsed.get(own));
        }
    }
    const merged = new Map();
    for (const e of edges) {
        const from = owner.get(e.from) || e.from;
        const to = owner.get(e.to) || e.to;
        if (from === to) continue;
        if (from === e.from && to === e.to && !merged.has(`${from}>${to}`)) {
            merged.set(`${from}>${to}`, { edge: e, parts: [e] });
            continue;
        }
        const key = `${from}>${to}`;
        const entry = merged.get(key);
        if (entry) entry.parts.push(e);
        else merged.set(key, { edge: { ...e, from, to }, parts: [e] });
    }
    const outEdges = [...merged.values()].map(({ edge, parts }) => {
        if (parts.length === 1 && parts[0] === edge) return edge;
        const out = { ...edge, from: edge.from, to: edge.to };
        const label = mergeLabels(parts.map((p) => p.label));
        if (label) out.label = label;
        else delete out.label;
        if (parts.every((p) => p.inferred)) out.inferred = true;
        else delete out.inferred;
        const statuses = [...new Set(parts.map((p) => p.status || ''))];
        if (statuses.length === 1 && statuses[0]) out.status = statuses[0];
        else if (statuses.some(Boolean)) out.status = 'modified';
        else delete out.status;
        out.merged = parts.length;
        return out;
    });
    return { ...graph, nodes: outNodes, edges: outEdges };
}

/** The collapsed node that hides `id` in a collapsed graph, if any. */
function collapsedOwner(graph, id) {
    return (graph?.nodes || []).find((n) => n.collapsed && n.members.includes(id))?.id || null;
}

export { COLLAPSED_PREFIX, collapseGraph, collapsedOwner, usableGroups };

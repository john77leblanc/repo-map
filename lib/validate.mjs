/**
 * Checks map.json for broken references so the map can be kept honest in CI.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

/** `docs` (optional) is docs.json: its links should point at cards that exist. */
function validateMap(root, config, map, docs) {
    const errors = [];
    const warnings = [];
    const groupIds = new Set();
    const nodeIds = new Set();
    const cols = config.columns.length;

    for (const g of map.groups) {
        if (!g.id) {
            errors.push('A group has no id');
            continue;
        }
        if (groupIds.has(g.id)) {
            errors.push(`Duplicate group id: ${g.id}`);
        }
        groupIds.add(g.id);
        if (!Number.isInteger(g.col) || g.col < 0 || g.col >= cols) {
            errors.push(`Group ${g.id} has col ${g.col}; expected 0-${cols - 1}`);
        }
    }
    for (const n of map.nodes) {
        if (!n.id) {
            errors.push('A node has no id');
            continue;
        }
        if (nodeIds.has(n.id)) {
            errors.push(`Duplicate node id: ${n.id}`);
        }
        nodeIds.add(n.id);
        if (!groupIds.has(n.group)) {
            errors.push(`Node ${n.id} is in unknown group ${n.group}`);
        }
        if (!config.kinds[n.kind]) {
            errors.push(`Node ${n.id} has unknown kind ${n.kind} (known: ${Object.keys(config.kinds).join(', ')})`);
        }
        if (n.path && !existsSync(path.join(root, n.path))) {
            warnings.push(`Node ${n.id} points at missing path ${n.path}`);
        }
    }
    const seen = new Set();
    for (const e of map.edges) {
        if (!nodeIds.has(e.from)) {
            errors.push(`Edge from unknown node ${e.from}`);
        }
        if (!nodeIds.has(e.to)) {
            errors.push(`Edge to unknown node ${e.to}`);
        }
        if (!config.edgeTypes[e.type]) {
            errors.push(`Edge ${e.from} -> ${e.to} has unknown type ${e.type}`);
        }
        const key = `${e.from}|${e.to}|${e.type}`;
        if (seen.has(key)) {
            warnings.push(`Duplicate edge ${e.from} -> ${e.to} (${e.type})`);
        }
        seen.add(key);
    }
    for (const g of groupIds) {
        if (!map.nodes.some((n) => n.group === g)) {
            warnings.push(`Group ${g} has no nodes`);
        }
    }
    for (const id of Object.keys((docs && docs.links) || {})) {
        if (!nodeIds.has(id)) {
            warnings.push(`docs.json links documents to unknown node ${id} (run \`repo-map docs\` to relink)`);
        }
    }
    return { errors, warnings, counts: { groups: groupIds.size, nodes: nodeIds.size, edges: map.edges.length } };
}

export { validateMap };

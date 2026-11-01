/** Browser-safe: a trace's Components output (the components a process involves, and proposed changes). */
import { COMPONENT_TAGS, normalizeComponents } from './components-data.mjs';

const text = (value, max = 2000) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const list = (value) => Array.isArray(value) ? value : [];
const refs = (value) => list(value).slice(0, 3).filter((r) => r && typeof r.path === 'string'
    && !/^(?:[\\/]|[a-z]:)/i.test(r.path) && !r.path.split(/[\\/]/).some((s) => s === '..' || s === '.repo-map' || s.startsWith('.env')))
    .map((r) => ({ path: text(r.path, 300), start: Math.max(1, Number(r.start) || 1),
        end: Math.max(1, Number(r.start) || 1, Number(r.end) || 1), why: text(r.why, 300),
        ...(typeof r.rev === 'string' && /^[a-f\d]{7,64}$/i.test(r.rev) ? { rev: r.rev } : {}) }));
const status = (value) => ['new', 'modified', 'removed'].includes(value);
const useKey = (use) => `${use.from}\n${use.to}`;

/**
 * Clean a trace's Components output. `snapshot` is the repository component map the
 * trace was made against (omit it for a saved output, which carries its own `base`).
 * Changes are kept only for proposals and reviews; new component ids start "proposal-".
 */
function normalizeComponentsTrace(raw, snapshot, intent = 'description') {
    if (!raw || typeof raw !== 'object' || (raw.version !== undefined && raw.version !== 1)) return null;
    const changing = intent === 'proposal' || intent === 'review';
    const clean = normalizeComponents(snapshot || raw.base);
    if (!clean || !['relevant', 'none'].includes(raw.applicability)) return null;
    // the snapshot only: freshness fields belong to the repository map
    const base = { version: 1, applicability: clean.applicability, summary: clean.summary,
        components: clean.components, uses: clean.uses, screens: clean.screens, gaps: clean.gaps };
    for (const component of base.components) component.refs = refs(component.refs);
    const none = raw.applicability === 'none';
    const gaps = list(raw.gaps).map((s) => text(s)).filter(Boolean).slice(0, 30);
    const known = new Map(base.components.map((c) => [c.id, c]));
    const components = [], seen = new Set();
    if (changing) for (const change of list(raw.changes?.components).slice(0, 200)) {
        if (!change || !status(change.status) || typeof change.id !== 'string' || seen.has(change.id)) continue;
        const original = known.get(change.id);
        if (change.status === 'new' ? original || !/^proposal-[\w-]{1,70}$/.test(change.id) : !original) continue;
        const merged = { ...original, ...change };
        if (!text(merged.label)) continue;
        const cleaned = { id: change.id, label: text(merged.label, 90), detail: text(merged.detail, 1000),
            tags: [...new Set(list(merged.tags).filter((tag) => COMPONENT_TAGS.includes(tag)))],
            refs: refs(change.refs ?? original?.refs), status: change.status, rationale: text(change.rationale) };
        components.push(cleaned);
        known.set(change.id, cleaned);
        seen.add(change.id);
    }
    const baseUses = new Set(base.uses.map(useKey));
    const uses = [], useSeen = new Set();
    // a render link is added or removed; nothing about it can be "modified"
    if (changing) for (const change of list(raw.changes?.uses).slice(0, 400)) {
        if (!change || !['new', 'removed'].includes(change.status)) continue;
        const key = useKey(change);
        if (!known.has(change.from) || !known.has(change.to) || change.from === change.to || useSeen.has(key)) continue;
        if (change.status === 'new' ? baseUses.has(key) : !baseUses.has(key)) continue;
        uses.push({ from: change.from, to: change.to, status: change.status, rationale: text(change.rationale) });
        useSeen.add(key);
    }
    const involved = [], involvedSeen = new Set();
    for (const item of list(raw.involved).slice(0, 80)) {
        if (!item || !known.has(item.id) || !text(item.note) || involvedSeen.has(item.id)) continue;
        involved.push({ id: item.id, note: text(item.note), refs: refs(item.refs) });
        involvedSeen.add(item.id);
    }
    if (!none && !involved.length && !components.length && !uses.length) return null;
    if (none && !text(raw.summary)) return null;
    if (involved.length !== list(raw.involved).length) gaps.push('Some involved components were unknown or repeated and were omitted.');
    if (changing && (components.length !== list(raw.changes?.components).length || uses.length !== list(raw.changes?.uses).length))
        gaps.push('Some proposed component changes were invalid, duplicated, or beyond the size limit and were omitted.');
    return { version: 1, base, applicability: raw.applicability, summary: text(raw.summary), gaps,
        involved: none ? [] : involved,
        changes: { components: none ? [] : components, uses: none ? [] : uses } };
}

/** The base map with the output's changes applied: changed components replace theirs, new ones and new links are added. */
function composeComponentsTrace(output) {
    const changes = new Map(output.changes.components.map((c) => [c.id, c]));
    const components = output.base.components.map((c) => changes.get(c.id) || c);
    components.push(...output.changes.components.filter((c) => c.status === 'new'));
    const useChanges = new Map(output.changes.uses.map((u) => [useKey(u), u]));
    const uses = output.base.uses.map((u) => useChanges.get(useKey(u)) || u);
    uses.push(...output.changes.uses.filter((u) => u.status === 'new'));
    return { ...output.base, components, uses };
}

/** Ids of the components a trace output touches: involved, changed, or at either end of a changed link. */
function componentsTouched(output) {
    const ids = new Set(output.involved.map((i) => i.id));
    for (const c of output.changes.components) ids.add(c.id);
    for (const u of output.changes.uses) { ids.add(u.from); ids.add(u.to); }
    return ids;
}

export { composeComponentsTrace, componentsTouched, normalizeComponentsTrace };

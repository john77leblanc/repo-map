import { normalizeSitemap } from './sitemap-data.mjs';

const text = (value, max = 2000) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const list = (value) => Array.isArray(value) ? value : [];
const refs = (value) => list(value).slice(0, 3).filter((r) => r && typeof r.path === 'string'
    && !/^(?:[\\/]|[a-z]:)/i.test(r.path) && !r.path.split(/[\\/]/).some((s) => s === '..' || s === '.repo-map' || s.startsWith('.env')))
    .map((r) => ({ path: text(r.path, 300), start: Math.max(1, Number(r.start) || 1),
        end: Math.max(1, Number(r.start) || 1, Number(r.end) || 1), why: text(r.why, 300) }));
const status = (value) => ['new', 'modified', 'removed'].includes(value);

/** A trace owns a snapshot; navigation indexes identify parallel links unambiguously. */
function normalizeSitemapTrace(raw, snapshot, intent = 'description') {
    if (!raw || typeof raw !== 'object' || (raw.version !== undefined && raw.version !== 1)) return null;
    // reviews mark the changes a diff made, the way proposals mark planned ones
    const changing = intent === 'proposal' || intent === 'review';
    const source = snapshot || raw.base;
    const base = normalizeSitemap(source);
    if (!base || !['relevant', 'none'].includes(raw.applicability)) return null;
    // Filtering a malformed snapshot would silently retarget its edge indexes.
    if (base.navigation.length !== source.navigation.length) return null;
    for (const item of [...base.screens, ...base.navigation]) item.refs = refs(item.refs);
    const screens = [], navigation = [], gaps = list(raw.gaps).map((s) => text(s)).filter(Boolean).slice(0, 30);
    const known = new Map(base.screens.map((s) => [s.id, s]));
    const seen = new Set();
    if (changing) for (const change of list(raw.changes?.screens).slice(0, 200)) {
        if (!change || !status(change.status) || seen.has(change.id)) continue;
        const original = known.get(change.id);
        if (change.status === 'new' ? original || !/^proposal-[\w-]{1,70}$/.test(change.id) : !original) continue;
        const screen = { ...original, ...change };
        if (!base.applications.some((a) => a.id === screen.app) || !text(screen.label)) continue;
        const cleaned = { id: change.id, app: screen.app, label: text(screen.label, 90), route: text(screen.route, 200),
            detail: text(screen.detail, 1000), refs: refs(change.refs ?? original?.refs), status: change.status, rationale: text(change.rationale) };
        screens.push(cleaned);
        known.set(change.id, cleaned);
        seen.add(change.id);
    }
    const edgeSeen = new Set();
    if (changing) for (const change of list(raw.changes?.navigation).slice(0, 400)) {
        if (!change || !status(change.status)) continue;
        const index = change.index;
        const original = Number.isInteger(index) && index >= 0 ? base.navigation[index] : null;
        if (change.status !== 'new' && (!original || edgeSeen.has(index))) continue;
        const edge = { ...original, ...change };
        if (!known.has(edge.from) || !known.has(edge.to) || edge.from === edge.to) continue;
        const cleaned = { from: edge.from, to: edge.to, label: text(edge.label, 60), condition: text(edge.condition, 200),
            refs: refs(change.refs ?? original?.refs), status: change.status, rationale: text(change.rationale),
            ...(change.status !== 'new' ? { index } : {}) };
        if (change.status === 'new' && [...base.navigation, ...navigation].some((e) =>
            e.from === cleaned.from && e.to === cleaned.to && e.label === cleaned.label && e.condition === cleaned.condition)) continue;
        navigation.push(cleaned);
        if (change.status !== 'new') edgeSeen.add(index);
    }
    const steps = list(raw.steps).slice(0, 80).filter((s) => s && known.has(s.screen) && text(s.note))
        .map((s) => ({ screen: s.screen, note: text(s.note), refs: refs(s.refs) }));
    const selected = [...new Set(list(raw.navigation).filter((i) => Number.isInteger(i) && i >= 0 && i < base.navigation.length))];
    if (raw.applicability === 'relevant' && !steps.length && !screens.length && !navigation.length) return null;
    if (raw.applicability === 'none' && !text(raw.summary)) return null;
    if (steps.length !== list(raw.steps).length) gaps.push('Some journey steps referenced unavailable screens and were omitted.');
    if (changing && (screens.length !== list(raw.changes?.screens).length || navigation.length !== list(raw.changes?.navigation).length))
        gaps.push('Some proposed changes were invalid, duplicated, or beyond the size limit and were omitted.');
    return { version: 1, base, applicability: raw.applicability, summary: text(raw.summary), gaps,
        steps: raw.applicability === 'none' ? [] : steps,
        navigation: raw.applicability === 'none' ? [] : selected,
        changes: { screens: raw.applicability === 'none' ? [] : screens, navigation: raw.applicability === 'none' ? [] : navigation } };
}

function composeSitemapTrace(output) {
    const changes = new Map(output.changes.screens.map((s) => [s.id, s]));
    const screens = output.base.screens.map((s) => changes.get(s.id) || s);
    screens.push(...output.changes.screens.filter((s) => s.status === 'new'));
    const navigation = output.base.navigation.map((edge, index) => ({ ...edge,
        ...output.changes.navigation.find((e) => e.index === index), index }));
    navigation.push(...output.changes.navigation.filter((e) => e.status === 'new'));
    return { ...output.base, screens, navigation };
}

export { normalizeSitemapTrace, composeSitemapTrace };

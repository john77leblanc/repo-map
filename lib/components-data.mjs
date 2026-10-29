/** Browser-safe normalization and derived views for the component map (`.repo-map/components.json`). */
const text = (value, max = 400) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const id = (value) => typeof value === 'string' && /^[\w-]{1,80}$/.test(value) ? value : '';
const list = (value) => Array.isArray(value) ? value : [];
const refs = (value) => list(value).slice(0, 3).filter((ref) => ref && typeof ref === 'object').map((ref) => ({
    path: text(ref.path, 300), start: Number(ref.start), end: Number(ref.end), why: text(ref.why, 200),
}));
const COMPONENT_TAGS = ['state', 'fetches', 'context', 'routing', 'form'];
const LIMITS = { components: 300, uses: 800, screens: 200 };
const DEPTH = 4;

/**
 * Clean a saved or AI-returned component map. `screenIds` (the sitemap's screen
 * ids) drops links to screens that no longer exist; omit it to keep them all.
 */
function normalizeComponents(raw, screenIds = null) {
    if (!raw || typeof raw !== 'object' || (raw.version !== undefined && raw.version !== 1)) return null;
    if (!['applicable', 'none', 'incomplete'].includes(raw.applicability)) return null;
    if (!Array.isArray(raw.components) || !Array.isArray(raw.uses) || !Array.isArray(raw.screens)) return null;
    const gaps = list(raw.gaps).map((gap) => text(gap)).filter(Boolean).slice(0, 30);
    const components = [];
    const ids = new Set();
    for (const item of raw.components.slice(0, LIMITS.components)) {
        if (!item || !id(item.id) || !text(item.label) || ids.has(item.id)) continue;
        const tags = [...new Set(list(item.tags).filter((tag) => COMPONENT_TAGS.includes(tag)))];
        components.push({ id: item.id, label: text(item.label, 90), detail: text(item.detail, 1000), tags,
            ...(id(item.card) ? { card: item.card } : {}), refs: refs(item.refs) });
        ids.add(item.id);
    }
    const uses = [];
    const seen = new Set();
    for (const use of raw.uses.slice(0, LIMITS.uses)) {
        if (!use || !ids.has(use.from) || !ids.has(use.to) || use.from === use.to) continue;
        const key = `${use.from}\n${use.to}`;
        if (seen.has(key)) continue;
        seen.add(key);
        uses.push({ from: use.from, to: use.to });
    }
    const screens = [];
    const pairs = new Set();
    let stale = false;
    for (const link of raw.screens.slice(0, LIMITS.screens)) {
        if (!link || !id(link.screen) || !ids.has(link.root)) continue;
        if (screenIds && !screenIds.has(link.screen)) { stale = true; continue; }
        const key = `${link.screen}\n${link.root}`;
        if (pairs.has(key)) continue;
        pairs.add(key);
        screens.push({ screen: link.screen, root: link.root });
    }
    if (components.length !== raw.components.length || uses.length !== raw.uses.length
        || screens.length + (stale ? 1 : 0) < raw.screens.length) {
        gaps.push('Some entries were invalid, duplicated, or beyond the size limit and were omitted.');
    }
    if (stale) gaps.push('Some screens are no longer in the sitemap. Regenerate components to refresh them.');
    if (raw.applicability === 'applicable' && !components.length) return null;
    if (raw.applicability === 'none' && components.length) return null;
    const summary = text(raw.summary, 1000);
    if (!summary) return null;
    return {
        version: 1, applicability: gaps.length && raw.applicability === 'applicable' ? 'incomplete' : raw.applicability,
        summary, components, uses, screens, gaps,
        ...(typeof raw.commit === 'string' && /^[a-f\d]{7,64}$/i.test(raw.commit) ? { commit: raw.commit } : {}),
        ...(typeof raw.generatedAt === 'string' && Number.isFinite(Date.parse(raw.generatedAt)) ? { generatedAt: raw.generatedAt } : {}),
        dirtyAtGeneration: raw.dirtyAtGeneration === true,
    };
}

/** Component id → ids of the components it renders. */
function childrenOf(data) {
    const children = new Map(data.components.map((c) => [c.id, []]));
    for (const use of data.uses) children.get(use.from)?.push(use.to);
    return children;
}

/**
 * The tree a component renders, to `depth` levels. A component already on the
 * path is marked `repeat` (cycles); deeper children are counted as `more`.
 */
function componentTree(data, rootId, depth = DEPTH) {
    const byId = new Map(data.components.map((c) => [c.id, c]));
    const children = childrenOf(data);
    const walk = (cid, path, level) => {
        const component = byId.get(cid);
        if (!component) return null;
        const below = children.get(cid) || [];
        if (path.has(cid)) return { id: cid, component, repeat: true, children: [], more: 0 };
        if (level >= depth) return { id: cid, component, children: [], more: below.length };
        const next = new Set(path).add(cid);
        return { id: cid, component, children: below.map((child) => walk(child, next, level + 1)).filter(Boolean), more: 0 };
    };
    return walk(rootId, new Set(), 1);
}

/** Component id → sorted screen ids whose tree (any depth) includes it. */
function componentUsage(data) {
    const children = childrenOf(data);
    const usage = new Map(data.components.map((c) => [c.id, new Set()]));
    for (const { screen, root } of data.screens) {
        const stack = [root];
        const seen = new Set();
        while (stack.length) {
            const cid = stack.pop();
            if (seen.has(cid)) continue;
            seen.add(cid);
            usage.get(cid)?.add(screen);
            stack.push(...(children.get(cid) || []));
        }
    }
    return new Map([...usage].map(([cid, set]) => [cid, [...set].sort()]));
}

/** Screen ids that show the given component. */
function screensUsing(data, componentId) {
    return componentUsage(data).get(componentId) || [];
}

/** Components shown on more than one screen. */
function sharedComponents(data) {
    const usage = componentUsage(data);
    return data.components.filter((c) => (usage.get(c.id) || []).length > 1);
}

/** Root component ids for a screen. */
function rootsFor(data, screenId) {
    return data.screens.filter((s) => s.screen === screenId).map((s) => s.root);
}

/** Components whose code refs fall in one of the changed files (repo-relative paths). */
function componentsInFiles(data, files) {
    const changed = new Set(list(files).map((file) => String(file).replace(/\\/g, '/')));
    return data.components.filter((c) => c.refs.some((ref) => changed.has(ref.path))).map((c) => c.id);
}

export { COMPONENT_TAGS, componentTree, componentUsage, componentsInFiles, normalizeComponents, rootsFor, screensUsing, sharedComponents };

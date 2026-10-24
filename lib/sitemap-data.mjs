/** Browser-safe normalization for the independently saved screen sitemap. */
const text = (value, max = 400) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const id = (value) => typeof value === 'string' && /^[\w-]{1,80}$/.test(value) ? value : '';
const refs = (value) => (Array.isArray(value) ? value : []).slice(0, 3).filter((ref) => ref && typeof ref === 'object').map((ref) => ({
    path: text(ref.path, 300), start: Number(ref.start), end: Number(ref.end), why: text(ref.why, 200),
}));

function normalizeSitemap(raw) {
    if (!raw || typeof raw !== 'object' || (raw.version !== undefined && raw.version !== 1)) return null;
    if (!['applicable', 'none', 'incomplete'].includes(raw.applicability)) return null;
    if (!Array.isArray(raw.applications) || !Array.isArray(raw.screens) || !Array.isArray(raw.navigation)) return null;
    const gaps = (Array.isArray(raw.gaps) ? raw.gaps : []).map((gap) => text(gap)).filter(Boolean).slice(0, 30);
    const applications = [];
    const appIds = new Set();
    for (const app of raw.applications.slice(0, 20)) {
        if (!app || !id(app.id) || !text(app.label) || appIds.has(app.id)) continue;
        applications.push({ id: app.id, label: text(app.label, 80) });
        appIds.add(app.id);
    }
    applications.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
    const screens = [];
    const screenIds = new Set();
    for (const screen of raw.screens.slice(0, 200)) {
        if (!screen || !id(screen.id) || !appIds.has(screen.app) || !text(screen.label) || screenIds.has(screen.id)) continue;
        screens.push({ id: screen.id, app: screen.app, label: text(screen.label, 90),
            route: text(screen.route, 200), detail: text(screen.detail, 1000), refs: refs(screen.refs) });
        screenIds.add(screen.id);
    }
    const navigation = [];
    const seen = new Set();
    for (const edge of raw.navigation.slice(0, 400)) {
        if (!edge || !screenIds.has(edge.from) || !screenIds.has(edge.to) || edge.from === edge.to) continue;
        const label = text(edge.label, 60), condition = text(edge.condition, 200);
        const key = JSON.stringify([edge.from, edge.to, label, condition]);
        if (seen.has(key)) continue;
        seen.add(key);
        navigation.push({ from: edge.from, to: edge.to, label, condition, refs: refs(edge.refs) });
    }
    if (screens.length !== raw.screens.length || navigation.length !== raw.navigation.length || applications.length !== raw.applications.length) {
        gaps.push('Some entries were invalid, duplicated, or beyond the size limit and were omitted.');
    }
    if (raw.applicability === 'applicable' && !screens.length) return null;
    if (raw.applicability === 'none' && screens.length) return null;
    const summary = text(raw.summary, 1000);
    if (!summary) return null;
    return {
        version: 1, applicability: gaps.length && raw.applicability === 'applicable' ? 'incomplete' : raw.applicability,
        summary, applications, screens, navigation, gaps,
        ...(typeof raw.commit === 'string' && /^[a-f\d]{7,64}$/i.test(raw.commit) ? { commit: raw.commit } : {}),
        ...(typeof raw.generatedAt === 'string' && Number.isFinite(Date.parse(raw.generatedAt)) ? { generatedAt: raw.generatedAt } : {}),
        dirtyAtGeneration: raw.dirtyAtGeneration === true,
    };
}

export { normalizeSitemap };

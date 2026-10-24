/** Compact prior findings, never a transcript or a source of current evidence. */
const MAX_CONTEXT = 12000;
const record = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const list = (value) => Array.isArray(value) ? value : [];
const text = (value, limit = 300) => {
    let result = typeof value === 'string' ? value.slice(0, limit) : '';
    while (JSON.stringify(result).length > limit + 2) result = result.slice(0, Math.floor(result.length * 0.8));
    return result;
};

function fields(value, names) {
    const source = record(value), result = {};
    for (const name of names.split(' ')) {
        if (!name) continue;
        const v = source[name];
        if (typeof v === 'string') result[name] = text(v);
        else if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) result[name] = v;
    }
    return result;
}

function traceContext(value, { flow = false, sitemap = null } = {}) {
    const source = record(value);
    if (!Object.keys(source).length) return null;
    const result = {
        prompt: text(source.prompt, 4000), intent: source.intent === 'proposal' ? 'proposal' : 'description',
        summary: text(source.summary, 1200), steps: [], refs: [], omitted: false,
    };
    const fit = () => JSON.stringify(result).length <= MAX_CONTEXT;
    const add = (target, key, value) => {
        target[key] = value;
        if (!fit()) { delete target[key]; result.omitted = true; }
    };
    const append = (target, values, limit, clean) => {
        if (values.length > limit) result.omitted = true;
        for (const value of values.slice(0, limit)) {
            const item = clean(value);
            if (!item) continue;
            target.push(item);
            if (!fit()) { target.pop(); result.omitted = true; }
        }
    };
    append(result.steps, list(source.steps), 15, (s) => ({ id: text(record(s).id, 100), note: text(record(s).note, 150) }));
    append(result.refs, list(source.refs), 10, (ref) => {
        const r = fields(ref, 'step path start end why');
        if (typeof r.path !== 'string' || !r.path || /^(?:[\\/]|[a-z]:)/i.test(r.path) || r.path.split(/[\\/]/).some((s) => s === '..' || s === '.repo-map' || s.startsWith('.env'))) return null;
        return r;
    });
    add(result, 'gaps', text(source.gaps, 800));
    const section = (key, sourceValue, scalarKeys, arrays) => {
        const input = record(sourceValue);
        if (!Object.keys(input).length) return;
        const output = fields(input, scalarKeys);
        add(result, key, output);
        if (!result[key]) return;
        for (const [name, keys] of Object.entries(arrays)) {
            add(output, name, []);
            if (output[name]) append(output[name], list(input[name]), 80,
                (v) => keys ? fields(v, keys) : text(v));
        }
    };
    section('proposal', source.proposal, 'rationale', {
        assumptions: '', questions: '', nodes: 'id status title group kind rationale suggestedPath',
        edges: 'from to status type label rationale',
    });
    if (flow) section('flow', source.flow, '', {
        nodes: 'id type label detail step lane status inferred', edges: 'from to label status inferred', lanes: 'id label',
    });
    if (sitemap) {
        const old = record(source.sitemap), base = record(old.base), changes = record(old.changes);
        // Resolve old navigation indexes before discarding the old base snapshot.
        section('sitemap', { ...old, screens: changes.screens, changes: list(changes.navigation).slice(0, 80).map((edge) => ({ ...record(list(base.navigation)[record(edge).index]), ...record(edge) })),
            navigation: list(old.navigation).slice(0, 80).map((i) => list(base.navigation)[i]) }, 'applicability summary', {
            steps: 'screen note', screens: 'id app label route status rationale detail',
            navigation: 'from to label', changes: 'from to label status rationale', gaps: '',
        });
    }
    return result;
}

export { MAX_CONTEXT, traceContext };

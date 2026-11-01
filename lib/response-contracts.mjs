/** AI wire contracts. Keep saved-file compatibility and repository semantics in their normalizers. */
import { extractJson } from './json.mjs';

const string = { type: 'string' };
const boolean = { type: 'boolean' };
const integer = (minimum = 0) => ({ type: 'integer', minimum });
const choice = (...values) => ({ type: 'string', enum: values });
const array = (items, limits = {}) => ({ type: 'array', items, ...limits });
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const strings = array(string);
const status = choice('new', 'modified', 'removed');
const intent = choice('description', 'proposal');
const ref = object({ path: string, start: integer(1), end: integer(1), why: string }, ['path', 'start', 'end']);
const refs = array(ref);
const connection = { from: string, to: string, label: string };
const flow = object({
    nodes: array(object({ id: string, type: choice('start', 'end', 'action', 'process', 'decision', 'error'),
        label: string, detail: string, step: integer(1), lane: string, inferred: boolean, status }, ['id', 'type', 'label']), { minItems: 2, maxItems: 40 }),
    edges: array(object({ ...connection, inferred: boolean, status }, ['from', 'to']), { maxItems: 80 }),
    lanes: array(object({ id: string, label: string, repo: string }, ['id', 'label']), { maxItems: 12 }),
}, ['nodes', 'edges']);
const proposal = object({
    rationale: string, assumptions: strings, questions: strings,
    nodes: array(object({ id: string, status, title: string, group: string, kind: string,
        rationale: string, suggestedPath: string }, ['id', 'status'])),
    edges: array(object({ ...connection, status, type: string, rationale: string }, ['from', 'to', 'status'])),
}, ['nodes', 'edges']);
const screen = { id: string, app: string, label: string, route: string, detail: string, refs };
const navigation = { ...connection, condition: string, refs };
const sitemapTrace = object({
    version: { type: 'integer', enum: [1] }, applicability: choice('relevant', 'none'), summary: string,
    steps: array(object({ screen: string, note: string, refs }, ['screen', 'note']), { maxItems: 80 }),
    navigation: array(integer()), gaps: strings,
    changes: object({
        screens: array(object({ ...screen, status, rationale: string }, ['id', 'status'])),
        navigation: array(object({ ...navigation, index: integer(), status, rationale: string }, ['status'])),
    }),
}, ['applicability', 'summary', 'steps', 'navigation', 'gaps', 'changes']);
const componentTag = choice('state', 'fetches', 'context', 'routing', 'form');
const componentsTrace = object({
    version: { type: 'integer', enum: [1] }, applicability: choice('relevant', 'none'), summary: string,
    involved: array(object({ id: string, note: string, refs }, ['id', 'note']), { maxItems: 80 }), gaps: strings,
    changes: object({
        components: array(object({ id: string, label: string, detail: string, tags: array(componentTag), status, rationale: string, refs }, ['id', 'status'])),
        uses: array(object({ from: string, to: string, status: choice('new', 'removed'), rationale: string }, ['from', 'to', 'status'])),
    }),
}, ['applicability', 'summary', 'involved', 'gaps', 'changes']);
const group = { id: string, col: integer(), title: string, open: boolean, note: string };
const node = { id: string, group: string, kind: string, tag: string, path: string, title: string, desc: string, facts: strings, provides: strings, consumes: strings };
const edge = { ...connection, type: string, inferred: boolean };
const patchSection = (fields, required, remove) => object({
    add: array(object(fields, required)), update: array(object(fields, ['id'])), remove: array(remove),
}, []);

const RESPONSE_SCHEMAS = {
    classify: object({ intent, title: string }),
    flow: object({ flow }),
    expand: object({ summary: string, gaps: string,
        nodes: array(object({ id: string, type: choice('end', 'action', 'process', 'decision', 'error'), label: string, detail: string,
            lane: string, inferred: boolean, status, refs }, ['id', 'type', 'label']), { minItems: 2, maxItems: 12 }),
        edges: array(object({ ...connection, inferred: boolean, status }, ['from', 'to']), { maxItems: 30 }),
        entry: string,
        exits: array(object({ arrow: integer(1), from: string }), { maxItems: 12 }),
    }, ['summary', 'nodes', 'edges', 'entry', 'exits']),
    plan: object({ summary: string, tasks: array(object({ title: string, detail: string, files: strings }), { minItems: 1 }),
        interfaces: strings, tests: strings, risks: strings, questions: strings }),
    generate: object({ groups: array(object(group, ['id', 'col', 'title'])),
        nodes: array(object(node, ['id', 'group', 'kind', 'path', 'desc'])),
        edges: array(object(edge, ['from', 'to', 'type'])) }),
    update: object({ summary: string,
        groups: patchSection(group, ['id', 'col', 'title'], string),
        nodes: patchSection(node, ['id', 'group', 'kind', 'path', 'desc'], string),
        edges: object({ add: array(object(edge, ['from', 'to', 'type'])),
            remove: array(object(edge, ['from', 'to'])) }, []),
    }, ['summary']),
    docs: object({ links: array(object({ node: string, ...ref.properties, title: string, kind: choice('guide', 'doc', 'comment') },
        ['node', 'path', 'start', 'end', 'title', 'why', 'kind'])) }),
    sitemap: object({ version: { type: 'integer', enum: [1] }, applicability: choice('applicable', 'none', 'incomplete'), summary: string,
        applications: array(object({ id: string, label: string }), { maxItems: 20 }),
        screens: array(object(screen), { maxItems: 200 }), navigation: array(object(navigation), { maxItems: 400 }), gaps: strings }),
    sitemapTrace: object({ sitemap: sitemapTrace }),
    components: object({ version: { type: 'integer', enum: [1] }, applicability: choice('applicable', 'none', 'incomplete'), summary: string,
        components: array(object({ id: string, label: string, detail: string,
            tags: array(componentTag), card: string, refs }, ['id', 'label', 'refs']), { maxItems: 300 }),
        uses: array(object({ from: string, to: string }), { maxItems: 800 }),
        screens: array(object({ screen: string, root: string }), { maxItems: 200 }), gaps: strings }),
    componentsTrace: object({ components: componentsTrace }),
    seams: object({ seams: array(object({ from: string, to: string, type: choice('http', 'event', 'sync'), label: string, why: string, refs },
        ['from', 'to', 'type', 'why', 'refs']), { maxItems: 40 }) }),
};

function traceSchema({ flow: includeFlow = false, sitemap = null, components = null, intent: selectedIntent = 'auto' } = {}) {
    const schema = object({ intent, title: string, summary: string,
        steps: array(object({ id: string, note: string, refs }, ['id', 'note', 'refs'])),
        edges: array(array(string, { minItems: 2, maxItems: 2 })), gaps: string,
        proposal, flow, sitemap: sitemapTrace, components: componentsTrace,
    }, ['intent', 'title', 'summary', 'steps', 'edges', 'gaps', ...(includeFlow ? ['flow'] : []), ...(sitemap ? ['sitemap'] : []), ...(components ? ['components'] : [])]);
    if (selectedIntent !== 'auto') schema.properties.intent = choice(selectedIntent);
    schema.anyOf = [
        { properties: { intent: choice('description') } },
        { properties: { intent: choice('proposal') }, required: ['proposal'] },
    ];
    return schema;
}

/** A review of a code change: the trace parts, with the change as a proposal-shaped diff of the map. */
function reviewSchema({ sitemap = false, components = false, flow: withFlow = true } = {}) {
    return object({ title: string, summary: string, risks: strings, questions: strings,
        steps: array(object({ id: string, note: string, refs }, ['id', 'note', 'refs'])),
        edges: array(array(string, { minItems: 2, maxItems: 2 })), gaps: string,
        changes: proposal, flow, sitemap: sitemapTrace, components: componentsTrace,
        files: array(object({ path: string, cards: strings, note: string }, ['path', 'cards'])),
    }, ['title', 'summary', 'risks', 'questions', 'steps', 'edges', 'gaps', 'changes', ...(withFlow ? ['flow'] : []), 'files', ...(sitemap ? ['sitemap'] : []), ...(components ? ['components'] : [])]);
}

/** Validate the JSON Schema vocabulary used above, without runtime dependencies or coercion. */
function schemaErrors(value, schema, path = '$') {
    const errors = [];
    const add = message => errors.push(`${path}: ${message}`);
    if (schema.anyOf && !schema.anyOf.some(candidate => !schemaErrors(value, candidate, path).length)) add('does not match any allowed shape');
    if (schema.enum && !schema.enum.includes(value)) add(`expected ${schema.enum.map(v => JSON.stringify(v)).join(' or ')}`);
    const validType = !schema.type || (schema.type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
        : schema.type === 'array' ? Array.isArray(value) : schema.type === 'integer' ? Number.isInteger(value) : typeof value === schema.type);
    if (!validType) { add(`expected ${schema.type}`); return errors; }
    if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) add(`must be at least ${schema.minimum}`);
    if (Array.isArray(value)) {
        if (schema.minItems !== undefined && value.length < schema.minItems) add(`requires at least ${schema.minItems} items`);
        if (schema.maxItems !== undefined && value.length > schema.maxItems) add(`allows at most ${schema.maxItems} items`);
        if (schema.items) value.forEach((item, i) => errors.push(...schemaErrors(item, schema.items, `${path}[${i}]`)));
    } else if (value !== null && typeof value === 'object') {
        for (const key of schema.required || []) if (!Object.hasOwn(value, key)) errors.push(`${path}.${key}: required`);
        for (const [key, item] of Object.entries(value)) {
            if (Object.hasOwn(schema.properties || {}, key)) errors.push(...schemaErrors(item, schema.properties[key], `${path}.${key}`));
            else if (schema.additionalProperties === false) errors.push(`${path}.${key}: unexpected field`);
        }
    }
    return errors;
}

function parseResponse(text, schema, label = 'AI tool') {
    const value = extractJson(text);
    const errors = schemaErrors(value, schema);
    if (errors.length) throw Object.assign(new Error(`${label} returned an invalid JSON response: ${errors.slice(0, 5).join('; ')}`),
        { code: 'schema', issues: errors.slice(0, 20) });
    return value;
}

function responsePrompt(prompt, schema) {
    return schema ? `${prompt}\n\nOUTPUT CONTRACT (JSON Schema; authoritative for response fields and types):\n${JSON.stringify(schema)}\nReturn one JSON object matching this contract. No Markdown fences or surrounding prose.` : prompt;
}

export { RESPONSE_SCHEMAS, parseResponse, responsePrompt, reviewSchema, schemaErrors, traceSchema };

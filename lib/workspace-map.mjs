/**
 * Workspaces: several repos' maps drawn as one. Pure and browser-safe.
 *
 * The home repo keeps its ids; a linked repo's node and group ids get a
 * `<link name>:` prefix. Seams are edges between repos: found by matching
 * contracts (lib/contracts.mjs), or stored in workspace.json after an AI pass
 * or by hand. Where a seam explains a placeholder card (an `external` node
 * such as "Orders API"), the placeholder is replaced by the real card.
 */
import { collapseGraph } from './collapse.mjs';
import { contractLabel, contractsMatch, matchContracts, normalizeContract } from './contracts.mjs';

const HOME = 'home';
const REPO_PREFIX = 'repo:';
const LINK_NAME = /^[a-z][a-z0-9-]{1,30}$/;
const RESERVED = new Set([HOME, 'repo', 'proposal', 'http', 'https', 'event', 'pkg', 'grpc', 'env', 'file', 'git', 'ssh']);
const SEAM_VIA = ['contract', 'ai', 'manual'];
const EDGE_TYPES = ['http', 'event', 'sync'];
const MAX_LINKS = 12;
const MAX_SEAMS = 200;
const SNAPSHOT_PATH = /^links\/[a-z][a-z0-9-]{1,30}\.map\.json$/;

const text = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const list = (v) => (Array.isArray(v) ? v : []);

function validLinkName(name) {
    return typeof name === 'string' && LINK_NAME.test(name) && !RESERVED.has(name);
}

/** Which repo an id belongs to: `api:orders-route` -> api; unprefixed ids are home. */
function repoOf(id, names) {
    const i = String(id).indexOf(':');
    return i > 0 && names.has(id.slice(0, i)) ? id.slice(0, i) : HOME;
}

function normalizeRef(r) {
    const p = text(r?.path, 400);
    if (!p) return null;
    const start = Math.max(1, parseInt(r.start, 10) || 1);
    return { path: p, start, end: Math.max(start, parseInt(r.end, 10) || start), ...(text(r.why, 300) ? { why: text(r.why, 300) } : {}) };
}

/** A stored seam, or null. Contract seams are recomputed, never stored. */
function normalizeSeam(s) {
    if (!s || typeof s !== 'object') return null;
    const from = text(s.from, 120);
    const to = text(s.to, 120);
    if (!from || !to || from === to) return null;
    const out = {
        from,
        to,
        type: EDGE_TYPES.includes(s.type) ? s.type : 'http',
        via: s.via === 'manual' ? 'manual' : 'ai',
    };
    if (text(s.label, 100)) out.label = text(s.label, 100);
    if (text(s.why, 600)) out.why = text(s.why, 600);
    const refs = list(s.refs).map(normalizeRef).filter(Boolean).slice(0, 3);
    if (refs.length) out.refs = refs;
    return out;
}

/** workspace.json, cleaned: unknown fields dropped, bad entries skipped. */
function normalizeWorkspace(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const names = new Set();
    const links = [];
    for (const l of list(r.links)) {
        if (links.length >= MAX_LINKS || !l || !validLinkName(l.name) || names.has(l.name)) continue;
        const dir = text(l.dir, 500);
        const snapshot = text(l.snapshot, 120);
        if (dir && !dir.includes('\0')) links.push({ name: l.name, dir });
        else if (SNAPSHOT_PATH.test(snapshot)) links.push({ name: l.name, snapshot });
        else continue;
        names.add(l.name);
    }
    const pairs = new Set();
    const seams = [];
    for (const s of list(r.seams)) {
        const seam = normalizeSeam(s);
        if (!seam || seams.length >= MAX_SEAMS || pairs.has(`${seam.from}>${seam.to}`)) continue;
        pairs.add(`${seam.from}>${seam.to}`);
        seams.push(seam);
    }
    return { links, seams };
}

const seamType = (key) => (key.startsWith('event:') ? 'event' : key.startsWith('http:') ? 'http' : 'sync');

/** Every consumer -> provider seam by contract, across all pairs of repos. */
function contractSeams(nodes, names) {
    const byRepo = new Map();
    for (const n of nodes) {
        const r = repoOf(n.id, names);
        if (!byRepo.has(r)) byRepo.set(r, []);
        byRepo.get(r).push(n);
    }
    const out = [];
    for (const [a, consumers] of byRepo) {
        for (const [b, providers] of byRepo) {
            if (a === b) continue;
            for (const m of matchContracts(consumers, providers)) {
                out.push({ from: m.from, to: m.to, type: seamType(m.keys[0]), label: contractLabel(m.keys[0]), via: 'contract', keys: m.keys });
            }
        }
    }
    return out;
}

/** Does a map edge's label describe the same call as a seam? ("POST /orders" vs http:POST /orders) */
function labelMatches(edge, seam) {
    if (!edge.label) return false;
    const kind = seam.type === 'event' ? 'event:' : 'http:';
    const key = normalizeContract(kind + edge.label);
    if (!key) return false;
    const seamKeys = seam.keys || [normalizeContract(kind + (seam.label || ''))].filter(Boolean);
    return seamKeys.some((k) => contractsMatch(key, k) || contractsMatch(k, key));
}

/**
 * Placeholder cards a seam explains. On the caller's side, the `external` card it
 * called (orders-client -> "Orders API") becomes the real provider; on the
 * provider's side, the `external` caller ("Storefront" -> orders-route) becomes
 * the real consumer. Picked by matching edge label, else the only candidate.
 */
function placeholders(nodes, edges, seams, names) {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const external = (id) => byId.get(id)?.kind === 'external';
    const alias = new Map();
    // the only candidate counts too, unless its label names a different call
    const unnamed = (e) => !e.label || (e.type !== 'event' && !e.label.includes('/'));
    const pick = (candidates, seam) => candidates.find((e) => labelMatches(e, seam))
        || (candidates.length === 1 && candidates[0].type === seam.type && unnamed(candidates[0]) ? candidates[0] : null);
    for (const s of seams) {
        const out = pick(edges.filter((e) => e.from === s.from && external(e.to) && repoOf(e.to, names) === repoOf(s.from, names)), s);
        if (out && !alias.has(out.to)) alias.set(out.to, s.to);
        const inn = pick(edges.filter((e) => e.to === s.to && external(e.from) && repoOf(e.from, names) === repoOf(s.to, names)), s);
        if (inn && !alias.has(inn.from)) alias.set(inn.from, s.from);
    }
    // never replace a card that is itself a seam's real endpoint
    for (const s of seams) {
        alias.delete(s.from);
        alias.delete(s.to);
    }
    return alias;
}

/**
 * One map from the home map and linked maps.
 *   home:   { groups, nodes, edges }
 *   linked: [{ name, title, map }]
 *   opts:   { seams (stored), columns (home column count), homeTitle }
 * Returns { groups, nodes, edges, repos, seams, replaced }. Inputs are not changed.
 */
function mergeMaps(home, linked, { seams = [], columns = 5, homeTitle = 'This repo' } = {}) {
    const names = new Set(linked.map((l) => l.name));
    const lastCol = Math.max(0, columns - 1);
    const groups = list(home.groups).map((g) => ({ ...g, repo: HOME }));
    const nodes = list(home.nodes).map((n) => ({ ...n, repo: HOME }));
    let edges = list(home.edges).map((e) => ({ ...e }));
    const repos = [{ name: HOME, title: homeTitle, count: nodes.length }];
    for (const l of linked) {
        const p = (id) => `${l.name}:${id}`;
        const m = l.map || {};
        groups.push(...list(m.groups).map((g) => ({ ...g, id: p(g.id), col: Math.min(lastCol, Math.max(0, g.col | 0)), repo: l.name })));
        nodes.push(...list(m.nodes).map((n) => ({ ...n, id: p(n.id), group: p(n.group), repo: l.name })));
        edges.push(...list(m.edges).map((e) => ({ ...e, from: p(e.from), to: p(e.to) })));
        repos.push({ name: l.name, title: l.title || l.name, count: list(m.nodes).length });
    }
    const ids = new Set(nodes.map((n) => n.id));
    const all = new Map();
    for (const s of contractSeams(nodes, names)) all.set(`${s.from}>${s.to}`, s);
    for (const raw of seams) {
        const s = normalizeSeam(raw);
        if (!s || !ids.has(s.from) || !ids.has(s.to) || repoOf(s.from, names) === repoOf(s.to, names)) continue;
        const key = `${s.from}>${s.to}`;
        all.set(key, { ...all.get(key), ...s });
    }
    const seamList = [...all.values()];
    const alias = placeholders(nodes, edges, seamList, names);
    const swap = (id) => alias.get(id) || id;
    const keptNodes = nodes.filter((n) => !alias.has(n.id));
    const pairs = new Map();
    const outEdges = [];
    for (const e of edges) {
        const out = { ...e, from: swap(e.from), to: swap(e.to) };
        if (out.from === out.to) continue;
        const key = `${out.from}>${out.to}|${out.type}`;
        if (pairs.has(key)) continue;
        pairs.set(key, out);
        outEdges.push(out);
    }
    for (const s of seamList) {
        const existing = outEdges.find((e) => e.from === s.from && e.to === s.to);
        const seam = { seam: s.via, ...(s.keys ? { keys: s.keys } : {}), ...(s.why ? { why: s.why } : {}), ...(s.refs ? { refs: s.refs } : {}) };
        if (existing) Object.assign(existing, seam, existing.label ? {} : (s.label ? { label: s.label } : {}));
        else outEdges.push({ from: s.from, to: s.to, type: s.type, ...(s.label ? { label: s.label } : {}), ...seam });
    }
    const usedGroups = new Set(keptNodes.map((n) => n.group));
    return {
        groups: groups.filter((g) => usedGroups.has(g.id)),
        nodes: keptNodes,
        edges: outEdges,
        repos,
        seams: seamList,
        replaced: Object.fromEntries(alias),
    };
}

/**
 * Fold whole repos into one card each. The card sits in its own group, in the
 * column most of the repo's cards were in. `repoIds` are `repo:<name>` ids.
 */
function collapseRepos(map, repoIds, titles = {}) {
    const wanted = new Set(list(repoIds).filter((id) => typeof id === 'string' && id.startsWith(REPO_PREFIX)));
    if (!wanted.size) return map;
    const colOf = new Map(map.groups.map((g) => [g.id, g.col]));
    const groups = [];
    for (const id of wanted) {
        const name = id.slice(REPO_PREFIX.length);
        const members = map.nodes.filter((n) => n.repo === name).map((n) => n.id);
        if (members.length < 2) continue;
        groups.push({ id, label: titles[name] || name, members });
    }
    if (!groups.length) return map;
    const out = collapseGraph(map, groups);
    const extra = [];
    out.nodes = out.nodes.map((n) => {
        if (!n.collapsed) return n;
        const g = groups.find((x) => 'c:' + x.id === n.id);
        const cols = n.members.map((m) => colOf.get(map.nodes.find((x) => x.id === m)?.group) ?? 0);
        const counts = new Map();
        cols.forEach((c) => counts.set(c, (counts.get(c) || 0) + 1));
        const col = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
        extra.push({ id: g.id, col, title: g.label, open: true, repo: g.id.slice(REPO_PREFIX.length) });
        return { ...n, group: g.id, kind: 'service', title: g.label, repo: g.id.slice(REPO_PREFIX.length) };
    });
    const used = new Set(out.nodes.map((n) => n.group));
    out.groups = [...map.groups.filter((g) => used.has(g.id)), ...extra];
    return out;
}

export { HOME, MAX_LINKS, REPO_PREFIX, collapseRepos, contractSeams, mergeMaps, normalizeSeam, normalizeWorkspace, repoOf, validLinkName };

/**
 * Contracts: what a map node offers to other code (`provides`) and what it
 * relies on (`consumes`), as typed keys. Matching keys across maps is how
 * repos are stitched together without an AI run.
 *
 *   http:<METHOD> <path>      http:POST /orders, http:GET /orders/{}   (METHOD may be ANY)
 *   event:<topic>             event:order.placed
 *   pkg:<name>                pkg:@shop/client
 *   grpc:<service>/<method>   grpc:orders.OrderService/PlaceOrder
 *   env:<VAR>                 env:ORDERS_API_URL   (a hint: where a base URL comes from)
 *
 * Pure and browser-safe.
 */

const CONTRACT_KINDS = ['http', 'event', 'pkg', 'grpc', 'env'];
const MAX_CONTRACTS = 12;
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'ANY']);

/** `/v1/orders/:id/` or `https://host/orders/{orderId}?x=1` -> `/v1/orders/{}` style paths. */
function normalizePath(raw) {
    let p = String(raw).trim().replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '');   // scheme and host
    p = p.replace(/[?#].*$/, '');
    p = p.split('/').filter(Boolean).map((seg) =>
        /^(:\w+\??|\{[^}]*\}|\[\[?\.{0,3}[^\]]*\]?\]|<[^>]*>|\*{1,2}|\$\{[^}]*\})$/.test(seg) ? '{}' : seg).join('/');
    return '/' + p;
}

/** Canonical form of one contract key, or '' when it isn't one. */
function normalizeContract(raw) {
    if (typeof raw !== 'string') return '';
    const m = raw.trim().match(/^([a-z]+)\s*:\s*(.+)$/i);
    if (!m) return '';
    const kind = m[1].toLowerCase();
    const body = m[2].trim().replace(/\s+/g, ' ').slice(0, 200);
    if (!CONTRACT_KINDS.includes(kind) || !body) return '';
    if (kind === 'http') {
        const parts = body.match(/^([A-Za-z*]+)\s+(\S+)$/);
        const method = parts ? parts[1].toUpperCase().replace('*', 'ANY') : 'ANY';
        const route = parts ? parts[2] : body;
        if (!HTTP_METHODS.has(method) || /\s/.test(route)) return '';
        return `http:${method} ${normalizePath(route)}`;
    }
    if (/\s/.test(body)) return '';
    if (kind === 'event' || kind === 'pkg') return `${kind}:${body.toLowerCase()}`;
    if (kind === 'env') return /^[A-Za-z_][\w]*$/.test(body) ? `env:${body.toUpperCase()}` : '';
    return `grpc:${body}`;
}

/** Clean a node's list: canonical, unique, capped. Unknown entries are dropped. */
function normalizeContracts(list) {
    const out = [];
    for (const item of Array.isArray(list) ? list : []) {
        const key = normalizeContract(item);
        if (key && !out.includes(key)) out.push(key);
        if (out.length >= MAX_CONTRACTS) break;
    }
    return out;
}

/** Entries in a node's raw list that normalizeContract can't read, for validation warnings. */
function invalidContracts(list) {
    return (Array.isArray(list) ? list : []).filter((item) => !normalizeContract(item));
}

/**
 * Does a consumed key meet a provided key? Same kind and body, with ANY matching
 * every HTTP method and `{}` matching any one path segment. `env:` keys never
 * match: they only explain where a URL comes from.
 */
function contractsMatch(consumed, provided) {
    const a = normalizeContract(consumed);
    const b = normalizeContract(provided);
    if (!a || !b || a.startsWith('env:') || b.startsWith('env:')) return false;
    if (a === b) return true;
    if (!a.startsWith('http:') || !b.startsWith('http:')) return false;
    const [ma, pa] = a.slice(5).split(' ');
    const [mb, pb] = b.slice(5).split(' ');
    if (ma !== mb && ma !== 'ANY' && mb !== 'ANY') return false;
    const sa = pa.split('/');
    const sb = pb.split('/');
    return sa.length === sb.length && sa.every((seg, i) => seg === sb[i] || seg === '{}' || sb[i] === '{}');
}

/**
 * Every consumer -> provider pairing between two node lists, by contract.
 * Returns [{ from, to, via: 'contract', keys: [consumedKey] }], one per node pair.
 */
function matchContracts(consumers, providers) {
    const pairs = new Map();
    for (const c of consumers) {
        for (const key of normalizeContracts(c.consumes)) {
            for (const p of providers) {
                if (p.id === c.id || !normalizeContracts(p.provides).some((k) => contractsMatch(key, k))) continue;
                const id = `${c.id}>${p.id}`;
                if (!pairs.has(id)) pairs.set(id, { from: c.id, to: p.id, via: 'contract', keys: [] });
                pairs.get(id).keys.push(key);
            }
        }
    }
    return [...pairs.values()];
}

/** Normalize provides/consumes on every node of a map, dropping empty lists. Returns a new map. */
function cleanMapContracts(map) {
    return { ...map, nodes: (map.nodes || []).map((n) => {
        const out = { ...n };
        for (const field of ['provides', 'consumes']) {
            const list = normalizeContracts(n[field]);
            if (list.length) out[field] = list;
            else delete out[field];
        }
        return out;
    }) };
}

/** Short reader-facing label: `POST /orders`, `event order.placed`. */
function contractLabel(key) {
    const k = normalizeContract(key);
    if (!k) return String(key);
    return k.startsWith('http:') ? k.slice(5).replace(/^ANY /, '') : k.replace(':', ' ');
}

export { CONTRACT_KINDS, cleanMapContracts, contractLabel, contractsMatch, invalidContracts, matchContracts, normalizeContract, normalizeContracts };

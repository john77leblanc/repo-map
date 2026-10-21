/**
 * Lays out and draws a trace's flowchart as SVG, top to bottom, with no
 * dependencies. Runs in the browser (served by lib/server.mjs) and in Node tests.
 *
 *   layoutFlow(flow)        -> { width, height, nodes, edges }
 *   renderFlowSvg(layout)   -> SVG markup (styled by classes; see app/index.html)
 *
 * Layered layout: break cycles (loops are drawn as return arrows on the right),
 * rank by longest path, add bend points for edges that skip ranks, order each
 * rank to reduce crossings, then place boxes as close to their neighbours as
 * the spacing allows (isotonic regression keeps order and gaps exact).
 */

const FONT_W = 6.7;          // average glyph width at 12.5px
const LINE_H = 16;
const PAD_X = 14;
const PAD_Y = 10;
const GAP_X = 34;
const GAP_Y = 58;
const DUMMY_W = 14;
const MARGIN = 24;

function wrap(text, maxChars) {
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = '';
    for (const w of words) {
        const next = cur ? `${cur} ${w}` : w;
        if (next.length <= maxChars || !cur) {
            cur = next;
        } else {
            lines.push(cur);
            cur = w;
        }
    }
    if (cur) {
        lines.push(cur);
    }
    return lines.length ? lines : [''];
}

function sizeNode(n) {
    if (n.type === 'decision') {
        const lines = wrap(n.label, 16);
        const tw = Math.max(...lines.map((l) => l.length)) * FONT_W;
        const th = lines.length * LINE_H;
        return { lines, w: Math.max(150, Math.round(tw * 2 + 12)), h: Math.max(70, Math.round(th * 2 + 14)) };
    }
    const lines = wrap(n.label, n.type === 'start' || n.type === 'end' ? 22 : 26);
    const tw = Math.max(...lines.map((l) => l.length)) * FONT_W;
    const skew = n.type === 'action' ? 22 : 0;
    const pill = n.type === 'start' || n.type === 'end' ? 12 : 0;
    return { lines, w: Math.max(120, Math.round(tw + PAD_X * 2 + skew + pill)), h: lines.length * LINE_H + PAD_Y * 2 };
}

/** Minimise sum (x_i - want_i)^2 subject to x_i - x_{i-1} >= sep_i (order kept). */
function placeRow(want, sep) {
    const off = [0];
    for (let i = 1; i < want.length; i++) {
        off.push(off[i - 1] + sep[i]);
    }
    const blocks = [];
    want.forEach((w, i) => {
        blocks.push({ sum: w - off[i], n: 1, start: i });
        while (blocks.length > 1) {
            const b = blocks[blocks.length - 1];
            const a = blocks[blocks.length - 2];
            if (a.sum / a.n <= b.sum / b.n) {
                break;
            }
            a.sum += b.sum;
            a.n += b.n;
            blocks.pop();
        }
    });
    const out = new Array(want.length);
    blocks.forEach((b) => {
        for (let i = b.start; i < b.start + b.n; i++) {
            out[i] = b.sum / b.n + off[i];
        }
    });
    return out;
}

function layoutFlow(flow) {
    const nodes = flow.nodes.map((n, i) => ({ ...n, ...sizeNode(n), idx: i }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges = flow.edges.filter((e) => byId.has(e.from) && byId.has(e.to)).map((e, i) => ({ ...e, idx: i }));
    const out = new Map(nodes.map((n) => [n.id, []]));
    edges.forEach((e) => out.get(e.from).push(e));

    // 1. Break cycles with a DFS from the start boxes, then any box nothing points at.
    const state = new Map();   // 1 = on stack, 2 = done
    const order = [];
    const indeg = new Map(nodes.map((n) => [n.id, 0]));
    edges.forEach((e) => indeg.set(e.to, indeg.get(e.to) + 1));
    const roots = [
        ...nodes.filter((n) => n.type === 'start'),
        ...nodes.filter((n) => n.type !== 'start' && indeg.get(n.id) === 0),
        ...nodes,
    ];
    const visit = (id) => {
        state.set(id, 1);
        order.push(id);
        for (const e of out.get(id)) {
            const s = state.get(e.to);
            if (s === 1) {
                e.back = true;
            } else if (!s) {
                visit(e.to);
            }
        }
        state.set(id, 2);
    };
    roots.forEach((n) => {
        if (!state.get(n.id)) {
            visit(n.id);
        }
    });
    const seenAt = new Map(order.map((id, i) => [id, i]));
    const fwd = edges.filter((e) => !e.back);

    // 2. Rank by longest path (topological order over forward edges).
    const rank = new Map(nodes.map((n) => [n.id, 0]));
    const deg = new Map(nodes.map((n) => [n.id, 0]));
    fwd.forEach((e) => deg.set(e.to, deg.get(e.to) + 1));
    const queue = nodes.filter((n) => deg.get(n.id) === 0).map((n) => n.id);
    const topo = [];
    while (queue.length) {
        const id = queue.shift();
        topo.push(id);
        for (const e of fwd.filter((x) => x.from === id)) {
            rank.set(e.to, Math.max(rank.get(e.to), rank.get(id) + 1));
            deg.set(e.to, deg.get(e.to) - 1);
            if (deg.get(e.to) === 0) {
                queue.push(e.to);
            }
        }
    }
    // Pull stray sources (not start boxes) down next to what they feed.
    for (const id of topo) {
        const n = byId.get(id);
        const succ = fwd.filter((e) => e.from === id);
        if (n.type !== 'start' && !fwd.some((e) => e.to === id) && succ.length) {
            rank.set(id, Math.max(0, Math.min(...succ.map((e) => rank.get(e.to))) - 1));
        }
    }

    // 3. Bend points for edges that skip ranks.
    const maxRank = Math.max(...rank.values());
    const layers = Array.from({ length: maxRank + 1 }, () => []);
    const items = new Map();   // id -> { id, w, h, rank, node?, dummy? }
    nodes.forEach((n) => {
        const it = { id: n.id, w: n.w, h: n.h, rank: rank.get(n.id), node: n, key: seenAt.get(n.id) };
        items.set(n.id, it);
        layers[it.rank].push(it);
    });
    const segs = [];   // [fromItemId, toItemId]
    fwd.forEach((e) => {
        const r0 = rank.get(e.from);
        const r1 = rank.get(e.to);
        e.chain = [e.from];
        for (let r = r0 + 1; r < r1; r++) {
            const id = `~${e.idx}.${r}`;
            const it = { id, w: DUMMY_W, h: 0, rank: r, dummy: true, key: seenAt.get(e.from) + 0.5 };
            items.set(id, it);
            layers[r].push(it);
            e.chain.push(id);
        }
        e.chain.push(e.to);
        for (let i = 1; i < e.chain.length; i++) {
            segs.push([e.chain[i - 1], e.chain[i], e.idx]);
        }
    });
    const up = new Map([...items.keys()].map((k) => [k, []]));
    const down = new Map([...items.keys()].map((k) => [k, []]));
    segs.forEach(([a, b, ei]) => {
        down.get(a).push({ id: b, ei });
        up.get(b).push({ id: a, ei });
    });

    // 4. Order each rank: DFS order first, then barycentre sweeps; keep the fewest crossings.
    layers.forEach((L) => L.sort((a, b) => a.key - b.key));
    const pos = new Map();
    const index = () => layers.forEach((L) => L.forEach((it, i) => pos.set(it.id, i)));
    index();
    const crossings = () => {
        let c = 0;
        for (let r = 0; r < layers.length - 1; r++) {
            const s = [];
            layers[r].forEach((it) => down.get(it.id).forEach((d) => s.push([pos.get(it.id), pos.get(d.id)])));
            for (let i = 0; i < s.length; i++) {
                for (let j = i + 1; j < s.length; j++) {
                    if ((s[i][0] - s[j][0]) * (s[i][1] - s[j][1]) < 0) {
                        c++;
                    }
                }
            }
        }
        return c;
    };
    let best = layers.map((L) => L.slice());
    let bestC = crossings();
    for (let iter = 0; iter < 8 && bestC > 0; iter++) {
        const downward = iter % 2 === 0;
        const rs = downward ? [...layers.keys()].slice(1) : [...layers.keys()].reverse().slice(1);
        for (const r of rs) {
            const nb = downward ? up : down;
            const bary = new Map(layers[r].map((it) => {
                const ps = nb.get(it.id).map((x) => pos.get(x.id));
                return [it.id, ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : pos.get(it.id)];
            }));
            layers[r].sort((a, b) => bary.get(a.id) - bary.get(b.id) || pos.get(a.id) - pos.get(b.id));
            layers[r].forEach((it, i) => pos.set(it.id, i));
        }
        const c = crossings();
        if (c < bestC) {
            bestC = c;
            best = layers.map((L) => L.slice());
        }
    }
    best.forEach((L, r) => {
        layers[r] = L;
    });
    index();

    // 5. x: start packed, then pull each item toward its neighbours, keeping order and gaps.
    const x = new Map();
    layers.forEach((L) => {
        let cur = 0;
        L.forEach((it) => {
            x.set(it.id, cur + it.w / 2);
            cur += it.w + GAP_X;
        });
        const shift = cur / 2;
        L.forEach((it) => x.set(it.id, x.get(it.id) - shift));
    });
    const sepOf = (L) => L.map((it, i) => (i ? (L[i - 1].w + it.w) / 2 + (L[i - 1].dummy && it.dummy ? 10 : GAP_X) : 0));
    for (let iter = 0; iter < 10; iter++) {
        const mode = iter % 3;   // 0: toward parents, 1: toward children, 2: both
        const rs = mode === 1 ? [...layers.keys()].reverse() : [...layers.keys()];
        for (const r of rs) {
            const L = layers[r];
            const want = L.map((it) => {
                const nbs = mode === 0 ? up.get(it.id) : mode === 1 ? down.get(it.id) : [...up.get(it.id), ...down.get(it.id)];
                if (!nbs.length) {
                    return x.get(it.id);
                }
                const xs = nbs.map((d) => x.get(d.id)).sort((a, b) => a - b);
                const m = xs.length >> 1;
                return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
            });
            placeRow(want, sepOf(L)).forEach((v, i) => x.set(L[i].id, v));
        }
    }

    // 6. y per rank.
    const labelled = new Set(fwd.filter((e) => e.label).map((e) => rank.get(e.from)));
    const rowH = layers.map((L) => Math.max(0, ...L.map((it) => it.h)));
    const rowY = [];
    let y = MARGIN;
    rowH.forEach((h, r) => {
        rowY.push(y);
        y += Math.max(h, 8) + GAP_Y + (labelled.has(r) ? 10 : 0);
    });
    const minX = Math.min(...[...items.values()].map((it) => x.get(it.id) - it.w / 2));
    const X = (id) => x.get(id) - minX + MARGIN;
    const cy = (it) => rowY[it.rank] + rowH[it.rank] / 2;
    nodes.forEach((n) => {
        const it = items.get(n.id);
        n.x = X(n.id) - n.w / 2;
        n.y = cy(it) - n.h / 2;
        n.cx = X(n.id);
        n.cy = cy(it);
    });
    let width = Math.max(...nodes.map((n) => n.x + n.w)) + MARGIN;
    const height = y - GAP_Y + MARGIN;

    // 7. Route edges.
    const inPorts = new Map();
    fwd.forEach((e) => {
        const last = e.chain[e.chain.length - 2];
        if (!inPorts.has(e.to)) {
            inPorts.set(e.to, []);
        }
        inPorts.get(e.to).push({ e, from: X(last) });
    });
    const inX = new Map();
    inPorts.forEach((list, id) => {
        const n = byId.get(id);
        list.sort((a, b) => a.from - b.from);
        const span = n.type === 'decision' ? 0 : Math.min(n.w * 0.5, (list.length - 1) * 18);
        list.forEach((p, i) => inX.set(p.e.idx, list.length > 1 ? n.cx - span / 2 + (span * i) / (list.length - 1) : n.cx));
    });
    const outCount = new Map();
    const outSeq = new Map();
    fwd.forEach((e) => outCount.set(e.from, (outCount.get(e.from) || 0) + 1));
    const outList = new Map();
    fwd.forEach((e) => {
        if (!outList.has(e.from)) {
            outList.set(e.from, []);
        }
        outList.get(e.from).push(e);
    });
    outList.forEach((list) => list.sort((a, b) => X(a.chain[1]) - X(b.chain[1])).forEach((e, i) => outSeq.set(e.idx, i)));

    const routed = [];
    fwd.forEach((e) => {
        const s = byId.get(e.from);
        const t = byId.get(e.to);
        const nextX = X(e.chain[1]);
        const k = outCount.get(e.from);
        let p0;
        let side = 0;
        if (s.type === 'decision' && k > 1 && nextX < s.cx - s.w / 4) {
            p0 = [s.x, s.cy];
            side = -1;
        } else if (s.type === 'decision' && k > 1 && nextX > s.cx + s.w / 4) {
            p0 = [s.x + s.w, s.cy];
            side = 1;
        } else {
            const span = s.type === 'decision' ? 0 : Math.min(s.w * 0.5, (k - 1) * 18);
            const i = outSeq.get(e.idx);
            p0 = [k > 1 ? s.cx - span / 2 + (span * i) / (k - 1) : s.cx, s.y + s.h];
        }
        const pts = [p0];
        e.chain.slice(1, -1).forEach((id) => {
            const it = items.get(id);
            pts.push([X(id), rowY[it.rank]], [X(id), rowY[it.rank] + rowH[it.rank]]);
        });
        pts.push([inX.get(e.idx), t.y]);
        let d = `M${r1(p0[0])},${r1(p0[1])}`;
        let from = p0;
        let label = null;
        pts.slice(1).forEach((p, i) => {
            if (i === 0 && side) {
                // leave a diamond's side: across, then down
                d += ` Q${r1(p[0])},${r1(from[1])} ${r1(p[0])},${r1(Math.min(p[1], from[1] + Math.abs(p[0] - from[0])))}`;
                if (p[1] > from[1] + Math.abs(p[0] - from[0])) {
                    d += ` L${r1(p[0])},${r1(p[1])}`;
                }
                label = label || [from[0] + side * 6, from[1] - 10, side < 0 ? 'end' : 'start'];
            } else if (Math.abs(p[0] - from[0]) < 0.5 || p[1] - from[1] < 1) {
                d += ` L${r1(p[0])},${r1(p[1])}`;
            } else {
                const dy = (p[1] - from[1]) / 2;
                d += ` C${r1(from[0])},${r1(from[1] + dy)} ${r1(p[0])},${r1(p[1] - dy)} ${r1(p[0])},${r1(p[1])}`;
            }
            if (!label) {
                const t2 = 0.42;
                label = [from[0] + (p[0] - from[0]) * t2, from[1] + Math.min(26, (p[1] - from[1]) * t2), 'mid'];
            }
            from = p;
        });
        routed.push({ ...e, d, label: e.label || '', labelAt: label });
    });

    // Loops: return arrows down the right-hand side.
    let lane = 0;
    edges.filter((e) => e.back).forEach((e) => {
        const s = byId.get(e.from);
        const t = byId.get(e.to);
        const top = Math.min(s.y, t.y);
        const bottom = Math.max(s.y + s.h, t.y + t.h);
        const rightmost = Math.max(...nodes.filter((n) => n.y + n.h >= top && n.y <= bottom).map((n) => n.x + n.w));
        const xr = rightmost + 26 + lane * 14;
        lane++;
        const sx = s.x + s.w;
        const tx = t.x + t.w + 2;
        const R = 8;
        const d = `M${r1(sx)},${r1(s.cy)} L${r1(xr - R)},${r1(s.cy)} Q${r1(xr)},${r1(s.cy)} ${r1(xr)},${r1(s.cy - R)} L${r1(xr)},${r1(t.cy + R)} Q${r1(xr)},${r1(t.cy)} ${r1(xr - R)},${r1(t.cy)} L${r1(tx)},${r1(t.cy)}`;
        width = Math.max(width, xr + MARGIN + (e.label ? e.label.length * 3.4 + 8 : 0));
        routed.push({ ...e, d, label: e.label || '', labelAt: [xr + 6, (s.cy + t.cy) / 2, 'start'] });
    });

    return {
        width: Math.ceil(width),
        height: Math.ceil(height),
        nodes: nodes.map(({ idx, ...n }) => n),
        edges: routed.sort((a, b) => a.idx - b.idx).map(({ chain, idx, ...e }) => e),
    };
}

function r1(v) {
    return Math.round(v * 10) / 10;
}

const escXml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function shapeOf(n) {
    const { x, y, w, h } = n;
    if (n.type === 'decision') {
        return `<polygon class="fs" points="${r1(x + w / 2)},${r1(y)} ${r1(x + w)},${r1(y + h / 2)} ${r1(x + w / 2)},${r1(y + h)} ${r1(x)},${r1(y + h / 2)}"/>`;
    }
    if (n.type === 'action') {
        const k = 11;
        return `<polygon class="fs" points="${r1(x + k)},${r1(y)} ${r1(x + w)},${r1(y)} ${r1(x + w - k)},${r1(y + h)} ${r1(x)},${r1(y + h)}"/>`;
    }
    const rx = n.type === 'start' || n.type === 'end' ? h / 2 : 6;
    return `<rect class="fs" x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="${r1(rx)}"/>`;
}

/** SVG markup for a layout. Boxes carry data-id and data-step for click handling. */
function renderFlowSvg(layout, { title = '' } = {}) {
    const parts = [];
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" class="fc" viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}" role="img" aria-label="${escXml(title || 'Flowchart')}">`);
    parts.push('<defs><marker id="fc-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path class="fa" d="M0 0.5L7.5 4L0 7.5z"/></marker></defs>');
    parts.push('<g class="fe-all">');
    layout.edges.forEach((e, i) => {
        parts.push(`<path class="fe${e.inferred ? ' inf' : ''}${e.back ? ' back' : ''}" data-i="${i}" d="${e.d}" marker-end="url(#fc-arrow)"/>`);
    });
    parts.push('</g><g class="fl-all">');
    layout.edges.forEach((e) => {
        if (!e.label) {
            return;
        }
        const [lx, ly, anchor] = e.labelAt;
        const w = e.label.length * 6.1 + 10;
        const x0 = anchor === 'start' ? lx : anchor === 'end' ? lx - w : lx - w / 2;
        parts.push(`<g class="fl"><rect x="${r1(x0)}" y="${r1(ly - 9)}" width="${r1(w)}" height="17" rx="3"/><text x="${r1(x0 + w / 2)}" y="${r1(ly + 3.5)}" text-anchor="middle">${escXml(e.label)}</text></g>`);
    });
    parts.push('</g>');
    layout.nodes.forEach((n) => {
        const label = `${n.label}${n.step ? ` (step ${n.step})` : ''}`;
        parts.push(`<g class="fn t-${n.type}${n.inferred ? ' inf' : ''}" data-id="${escXml(n.id)}"${n.step ? ` data-step="${n.step}"` : ''} tabindex="0" role="button" aria-label="${escXml(label)}">`);
        parts.push(shapeOf(n));
        const top = n.cy - ((n.lines.length - 1) * LINE_H) / 2 + 4.5;
        parts.push(`<text x="${r1(n.cx)}" y="${r1(top)}" text-anchor="middle">${n.lines.map((l, i) => `<tspan x="${r1(n.cx)}"${i ? ` dy="${LINE_H}"` : ''}>${escXml(l)}</tspan>`).join('')}</text>`);
        if (n.step) {
            const bx = n.type === 'decision' ? n.cx - n.w / 4 - 4 : n.x + 2;
            const by = n.type === 'decision' ? n.y + n.h / 4 - 4 : n.y + 2;
            parts.push(`<g class="fb"><circle cx="${r1(bx)}" cy="${r1(by)}" r="9"/><text x="${r1(bx)}" y="${r1(by + 3.5)}" text-anchor="middle">${n.step}</text></g>`);
        }
        parts.push('</g>');
    });
    parts.push('</svg>');
    return parts.join('');
}

export { layoutFlow, placeRow, renderFlowSvg, wrap };

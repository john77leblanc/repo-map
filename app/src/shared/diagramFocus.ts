/** Edge endpoints; any diagram edge shape with `from` and `to` works. */
interface FocusEdge { from: string; to: string }
/** What a diagram keeps bright while the rest dims: node ids and edge indices. `primary` nodes get the strongest emphasis. */
interface Highlight { nodes: string[]; edges: number[]; primary?: string[] }

/** The focused ids, the far end of every edge touching them, and those edges' indices. */
function neighborhood(edges: readonly FocusEdge[], focus: ReadonlySet<string>) {
    const nodes = new Set(focus);
    const touching: number[] = [];
    edges.forEach((edge, index) => {
        if (!focus.has(edge.from) && !focus.has(edge.to)) return;
        nodes.add(edge.from);
        nodes.add(edge.to);
        touching.push(index);
    });
    return { nodes, edges: touching };
}

export { neighborhood };
export type { FocusEdge, Highlight };

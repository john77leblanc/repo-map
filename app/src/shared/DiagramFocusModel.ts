import { makeAutoObservable } from 'mobx';
import { neighborhood, type FocusEdge, type Highlight } from './diagramFocus';

interface DiagramFocusSource {
    /** Current diagram layout; null when nothing is drawn. */
    layout: () => { edges: readonly FocusEdge[] } | null;
    /** Pinned (selected) node, kept in focus after the pointer leaves. */
    selected: () => string | null;
    /** Explicit highlight from outside the diagram, e.g. a hovered side-panel row. */
    override?: () => Highlight | null;
}

/**
 * Shared hover/pin focus for SVG diagrams. Priority: override, hovered node or
 * edge, pinned node. A focused node keeps its links and neighbours bright; a
 * hovered edge keeps itself and its two ends bright.
 */
class DiagramFocusModel {
    hoverId: string | null = null;
    hoverEdgeIndex: number | null = null;
    /** The edge end a side-panel row names, emphasised above the other end. */
    hoverPrimary: string | null = null;

    constructor(private readonly source: DiagramFocusSource) {
        makeAutoObservable<this, 'source'>(this, { source: false }, { autoBind: true });
    }
    hover(id: string | null) {
        if (this.hoverId !== id) this.hoverId = id;
        if (this.hoverEdgeIndex !== null) this.hoverEdgeIndex = null;
        if (this.hoverPrimary !== null) this.hoverPrimary = null;
    }
    /** Hover a layout edge by index; no pinning. `primary` names the end to emphasise, if any. */
    hoverEdge(index: number | null, primary: string | null = null) {
        if (this.hoverEdgeIndex !== index) this.hoverEdgeIndex = index;
        const main = index === null ? null : primary;
        if (this.hoverPrimary !== main) this.hoverPrimary = main;
        if (this.hoverId !== null) this.hoverId = null;
    }
    reset() {
        this.hoverId = null;
        this.hoverEdgeIndex = null;
        this.hoverPrimary = null;
    }
    get highlight(): Highlight | null {
        const layout = this.source.layout();
        if (!layout) return null;
        const override = this.source.override?.();
        if (override) return override;
        const edge = this.hoverEdgeIndex === null ? undefined : layout.edges[this.hoverEdgeIndex];
        if (edge) return {
            nodes: [...new Set([edge.from, edge.to])],
            edges: [this.hoverEdgeIndex!],
            primary: this.hoverPrimary ? [this.hoverPrimary] : [],
        };
        const id = this.hoverId || this.source.selected();
        if (!id) return null;
        const { nodes, edges } = neighborhood(layout.edges, new Set([id]));
        return { nodes: [...nodes], edges, primary: [id] };
    }
}

export { DiagramFocusModel };
export type { DiagramFocusSource };

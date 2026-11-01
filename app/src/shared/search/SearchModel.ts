import { makeAutoObservable } from 'mobx';

/** One searchable diagram item. */
export interface SearchItem {
    id: string;
    title: string;
    /** Names (id, title, route…): a match here needs no snippet. */
    names: string[];
    /** Description text, matched and shown as a snippet. */
    desc?: string;
    /** File paths (code references), matched and shown as a snippet. */
    paths?: string[];
    /** Class suffix for the result's dot (`k-<kind>`). */
    kind?: string;
}
export interface SearchGroup {
    id: string;
    /** Empty: the group has no heading. */
    title: string;
    /** Tag before the heading, e.g. the linked repo. */
    tag?: string;
    items: SearchItem[];
}
export interface SearchSection {
    id: string;
    title: string;
    groups: SearchGroup[];
}
/** Text around a hit, for results matched only by description or path. */
export interface SearchSnippet {
    before: string;
    hit: string;
    after: string;
}
export interface SearchHit {
    item: SearchItem;
    snippet?: SearchSnippet;
}
export interface SearchResultSection {
    id: string;
    title: string;
    groups: { id: string; title: string; tag?: string; hits: SearchHit[] }[];
}

/** About `width` characters of `text` centred on the first match of `q` (lower-case). */
function snippetOf(text: string, q: string, width = 70): SearchSnippet | undefined {
    const at = text.toLowerCase().indexOf(q);
    if (at < 0) return undefined;
    const start = Math.max(0, at - Math.floor((width - q.length) / 2));
    const end = Math.min(text.length, Math.max(start + width, at + q.length));
    return {
        before: (start > 0 ? '…' : '') + text.slice(start, at),
        hit: text.slice(at, at + q.length),
        after: text.slice(at + q.length, end) + (end < text.length ? '…' : ''),
    };
}

/**
 * Move the items named in `ids` (in that order) out of `sections` into a first
 * section, e.g. the cards a trace visits. Nothing changes when none are present.
 */
function pinFirst(sections: SearchSection[], ids: string[], title = 'In this trace'): SearchSection[] {
    const pinned = new Set(ids);
    const byId = new Map(sections.flatMap((s) => s.groups.flatMap((g) => g.items)).map((item) => [item.id, item]));
    const items = [...pinned].flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
    if (!items.length) return sections;
    return [
        { id: 'pinned', title, groups: [{ id: 'pinned', title: '', items }] },
        ...sections.map((s) => ({ ...s, groups: s.groups.map((g) => ({ ...g, items: g.items.filter((i) => !pinned.has(i.id)) })) })),
    ];
}

const has = (text: string | undefined, q: string) => !!text && text.toLowerCase().includes(q);

/**
 * Side-panel search over a diagram's items: query, results by section and group,
 * and a keyboard cursor. The view model supplies the sections; picking is its job.
 */
class SearchModel {
    query = '';
    open = false;
    /** Highlighted result, an index into `hits`. */
    cursor = 0;

    /** `onQuery` runs after each change to the query, e.g. to open the groups holding matches. */
    constructor(private readonly source: { sections: () => SearchSection[]; onQuery?: () => void }) {
        makeAutoObservable<this, 'source'>(this, { source: false }, { autoBind: true });
    }
    get q() {
        return this.query.trim().toLowerCase();
    }
    matches(item: SearchItem) {
        const q = this.q;
        return !!q && (item.names.some((s) => has(s, q)) || has(item.desc, q) || !!item.paths?.some((p) => has(p, q)));
    }
    /** Matching items by section and group; every item when the query is empty. */
    get sections(): SearchResultSection[] {
        const q = this.q;
        return this.source
            .sections()
            .map((s) => ({
                id: s.id,
                title: s.title,
                groups: s.groups
                    .map((g) => ({
                        id: g.id,
                        title: g.title,
                        tag: g.tag,
                        hits: g.items
                            .filter((item) => !q || this.matches(item))
                            .map((item) => ({ item, snippet: q ? this.snippet(item) : undefined })),
                    }))
                    .filter((g) => g.hits.length),
            }))
            .filter((s) => s.groups.length);
    }
    private snippet(item: SearchItem) {
        const q = this.q;
        if (item.names.some((s) => has(s, q))) return undefined;
        if (has(item.desc, q)) return snippetOf(item.desc!, q);
        const path = item.paths?.find((p) => has(p, q));
        return path ? snippetOf(path, q) : undefined;
    }
    /** Result ids in display order, for arrow keys. */
    get hits(): string[] {
        return this.sections.flatMap((s) => s.groups.flatMap((g) => g.hits.map((h) => h.item.id)));
    }
    /** Ids matching a non-empty query, for highlighting on the diagram. */
    get matched(): Set<string> {
        return new Set(this.q ? this.hits : []);
    }
    /** The highlighted result's id. */
    get current(): string | undefined {
        return this.hits[this.cursor];
    }
    /** Start on the first result whose name matches, so Enter skips description-only hits listed above it. */
    setQuery(value: string) {
        this.query = value;
        const q = this.q;
        const byName = this.sections.flatMap((s) => s.groups.flatMap((g) => g.hits))
            .findIndex((h) => h.item.names.some((n) => has(n, q)));
        this.cursor = Math.max(0, byName);
        this.source.onQuery?.();
    }
    openSearch() {
        this.open = true;
        this.cursor = 0;
    }
    /** Close the results and clear the query. */
    close() {
        this.open = false;
        this.query = '';
        this.cursor = 0;
    }
    move(by: number) {
        const last = this.hits.length - 1;
        this.cursor = Math.max(0, Math.min(last, this.cursor + by));
    }
    setCursor(index: number) {
        this.cursor = index;
    }
}

export { SearchModel, pinFirst, snippetOf };

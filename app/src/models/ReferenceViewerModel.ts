import { makeAutoObservable, observableRef, runInAction } from 'mobx';
import type { CodeRef, FileContent } from './types';
import type { RepositoryModel } from './RepositoryModel';
import { CopyFeedback } from './CopyFeedback';

/** Lines shown around a reference, above and below the cited ones. */
const CONTEXT = 5;

/**
 * The code reference modal: one list of references (a step's, a card's…), the open one,
 * and its lines read live from the checkout. Opened from any `CodeReference` row.
 */
export class ReferenceViewerModel {
    list: CodeRef[] = [];
    index = 0;
    documentation = false;
    content: FileContent | null = null;
    loading = false;
    error = '';
    readonly copy = new CopyFeedback();
    private controller: AbortController | null = null;
    constructor(readonly repo: RepositoryModel) {
        makeAutoObservable<this, 'controller'>(
            this,
            { repo: false, copy: false, list: observableRef, controller: false },
            { autoBind: true }
        );
    }
    get isOpen() {
        return this.list.length > 0;
    }
    get current(): CodeRef | null {
        return this.list[this.index] || null;
    }
    get hasPrev() {
        return this.index > 0;
    }
    get hasNext() {
        return this.index < this.list.length - 1;
    }
    /** Link to the cited lines on GitHub; none for a linked repo's file (`api:src/x.js`). */
    get href() {
        const r = this.current;
        const info = this.repo.bootstrap?.repo;
        if (!r || !info?.ghBase || /^[a-z][a-z0-9-]{1,30}:/.test(r.path)) return '';
        const plain = this.isDocument && /\.(md|mdx|mdc)$/i.test(r.path) ? '?plain=1' : '';
        return `${info.ghBase}/blob/${info.ghRef}/${r.path}${plain}#L${r.start}-L${r.end}`;
    }
    /** A document (guide, doc, comment) rather than code: shown by its title, read as plain text on GitHub. */
    get isDocument() {
        return this.documentation || !!this.current?.kind;
    }
    /** GitHub may show different lines when the checkout isn't the pushed commit. */
    get exact() {
        return !!this.repo.bootstrap?.repo.exact;
    }
    /** A line number inside the cited range (the rest is context). */
    cited(line: number) {
        const r = this.current;
        return !!r && line >= r.start && line <= r.end;
    }
    open(list: CodeRef[], index = 0, documentation = false) {
        this.list = list.slice();
        this.documentation = documentation;
        this.show(index);
    }
    prev() {
        if (this.hasPrev) this.show(this.index - 1);
    }
    next() {
        if (this.hasNext) this.show(this.index + 1);
    }
    /** Read the open reference again, e.g. after a failed read. */
    retry() {
        if (this.current) this.show(this.index);
    }
    close() {
        this.abort();
        this.list = [];
        this.index = 0;
        this.content = null;
        this.loading = false;
        this.error = '';
        this.copy.reset();
    }
    async copyPath() {
        const r = this.current;
        if (!r) return;
        try {
            await this.repo.services.browser.copy(`${r.path}#L${r.start}-L${r.end}`);
            if (this.current === r) this.copy.flash();
        } catch {
            runInAction(() => {
                if (this.current === r) this.error = "Couldn't copy to the clipboard.";
            });
        }
    }
    dispose() {
        this.close();
        this.copy.dispose();
    }
    private show(index: number) {
        this.abort();
        this.index = Math.max(0, Math.min(index, this.list.length - 1));
        this.content = null;
        this.error = '';
        this.copy.reset();
        void this.load();
    }
    private async load() {
        const r = this.current;
        if (!r) return;
        this.loading = true;
        const controller = (this.controller = new AbortController());
        const start = Math.max(1, r.start - CONTEXT);
        try {
            const content = await this.repo.services.api.get<FileContent>(
                `/api/file?path=${encodeURIComponent(r.path)}&start=${start}&end=${r.end + CONTEXT}`,
                controller.signal
            );
            if (!controller.signal.aborted)
                runInAction(() => {
                    this.content = content;
                });
        } catch (error) {
            if (!controller.signal.aborted)
                runInAction(() => {
                    this.error = `Couldn't read ${r.path} from your checkout (${error instanceof Error ? error.message : error}). It may have moved since this was saved.`;
                });
        } finally {
            if (this.controller === controller)
                runInAction(() => {
                    this.loading = false;
                    this.controller = null;
                });
        }
    }
    private abort() {
        this.controller?.abort();
        this.controller = null;
    }
}

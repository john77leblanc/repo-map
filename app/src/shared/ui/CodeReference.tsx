import { useEffect, useMemo, useRef } from 'react';
import { makeAutoObservable, runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import type { CodeRef, FileContent } from '../../models/types';
import type { RepositoryModel } from '../../models/RepositoryModel';

export class CodeReferenceViewModel {
    content: FileContent | null = null;
    loading = false;
    error = '';
    private controller: AbortController | null = null;
    constructor(
        readonly reference: CodeRef,
        readonly repo: RepositoryModel
    ) {
        makeAutoObservable<this, 'controller'>(
            this,
            { reference: false, repo: false, controller: false },
            { autoBind: true }
        );
    }
    async load() {
        if (this.content || this.loading) return;
        this.loading = true;
        this.error = '';
        const controller = (this.controller = new AbortController());
        const r = this.reference;
        try {
            const content = await this.repo.services.api.get<FileContent>(
                `/api/file?path=${encodeURIComponent(r.path)}&start=${r.start}&end=${Math.min(r.end, r.start + 79)}`,
                controller.signal
            );
            if (!controller.signal.aborted)
                runInAction(() => {
                    this.content = content;
                });
        } catch (error) {
            if (!controller.signal.aborted)
                runInAction(() => {
                    this.error = `Couldn't read ${r.path} from your checkout (${error instanceof Error ? error.message : error}). It may have moved since this trace was saved.`;
                });
        } finally {
            if (this.controller === controller)
                runInAction(() => {
                    this.loading = false;
                    this.controller = null;
                });
        }
    }
    dispose() {
        this.controller?.abort();
    }
}

export const CodeReference = observer(function CodeReference({
    reference,
    repo,
    documentation = false,
}: {
    reference: CodeRef;
    repo: RepositoryModel;
    documentation?: boolean;
}) {
    const vm = useMemo(
        () => new CodeReferenceViewModel(reference, repo),
        [repo, reference.path, reference.start, reference.end]
    );
    const details = useRef<HTMLDetailsElement>(null);
    useEffect(() => {
        if (details.current?.open) void vm.load();
        return () => vm.dispose();
    }, [vm]);
    const info = repo.bootstrap?.repo;
    // a linked repo's file (`api:src/x.js`) has no link into this repo on GitHub
    const href = info?.ghBase && !/^[a-z][a-z0-9-]{1,30}:/.test(reference.path)
        ? `${info.ghBase}/blob/${info.ghRef}/${reference.path}${documentation && /\.(md|mdx|mdc)$/i.test(reference.path) ? '?plain=1' : ''}#L${reference.start}-L${reference.end}`
        : '';
    return (
        <details
            ref={details}
            className="ref"
            onToggle={(event) => {
                if (event.currentTarget.open) void vm.load();
            }}
        >
            <summary>
                <svg className="car" viewBox="0 0 10 10">
                    <path d="M3.5 2l3 3-3 3" />
                </svg>
                <span className="fn">
                    {(documentation && reference.title) || reference.path.split('/').pop()}
                </span>
                <span className="fu" title={reference.path}>
                    {documentation
                        ? reference.path
                        : '…/' + reference.path.split('/').slice(-2).join('/')}
                    #L{reference.start}-L{reference.end}
                </span>
                {documentation && (
                    <span className={'kb ' + (reference.kind || 'doc')}>
                        {(
                            { guide: 'Agent guide', doc: 'Doc', comment: 'Code comment' } as Record<
                                string,
                                string
                            >
                        )[reference.kind || 'doc'] || 'Doc'}
                    </span>
                )}
                {href && (
                    <a
                        className="gh"
                        href={href}
                        target="_blank"
                        rel="noopener"
                        onClick={(event) => event.stopPropagation()}
                        title={
                            info?.exact
                                ? 'Open on GitHub'
                                : 'Open on GitHub (lines may differ from your checkout)'
                        }
                    >
                        ↗
                    </a>
                )}
            </summary>
            <p className="why">{reference.why}</p>
            <div className="code" role="region" aria-label={reference.path} tabIndex={0}>
                {vm.loading
                    ? 'Loading…'
                    : vm.error ||
                      vm.content?.lines.map((line, index) => (
                          <div className="cl2" key={index}>
                              <span className="ln">{vm.content!.start + index}</span>
                              <span className="lc">{line || ' '}</span>
                          </div>
                      ))}
                {vm.content &&
                    reference.end > vm.content.end &&
                    vm.content.end < (vm.content.total || 0) && (
                        <div className="more">
                            … {Math.min(reference.end, vm.content.total!) - vm.content.end} more
                            lines in the file
                        </div>
                    )}
            </div>
        </details>
    );
});

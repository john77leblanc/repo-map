import { observer } from 'mobx-react-lite';
import type { CodeRef } from '../../models/types';
import type { RepositoryModel } from '../../models/RepositoryModel';

const KIND_LABELS: Record<string, string> = { guide: 'Agent guide', doc: 'Doc', comment: 'Code comment' };

/**
 * One code or document reference: file name and lines. Clicking it opens the reference
 * modal (`repo.references`), with Prev/Next through `list` (the other references beside it).
 */
export const CodeReference = observer(function CodeReference({
    reference,
    repo,
    documentation = false,
    list,
    index,
}: {
    reference: CodeRef;
    repo: RepositoryModel;
    documentation?: boolean;
    /** The references listed with this one; defaults to just this one. */
    list?: CodeRef[];
    index?: number;
}) {
    const open = () => {
        const refs = list?.length ? list : [reference];
        const at = index ?? refs.indexOf(reference);
        repo.references.open(refs, at < 0 ? 0 : at, documentation);
    };
    return (
        <button className="ref" type="button" onClick={open}
            title={`${reference.path}#L${reference.start}-L${reference.end}`}>
            <span className="fn">
                {(documentation && reference.title) || reference.path.split('/').pop()}
            </span>
            <span className="fu">
                {documentation ? reference.path : '…/' + reference.path.split('/').slice(-2).join('/')}
                #L{reference.start}-L{reference.end}
            </span>
            {documentation && (
                <span className={'kb ' + (reference.kind || 'doc')}>
                    {KIND_LABELS[reference.kind || 'doc'] || 'Doc'}
                </span>
            )}
        </button>
    );
});

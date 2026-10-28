import { CodeReference } from '../../shared/ui/CodeReference';
import type { CodeRef } from '../../models/types';
import type { RepositoryModel } from '../../models/RepositoryModel';

export function DocumentationReference({
    reference,
    repo,
    list,
    index,
}: {
    reference: CodeRef;
    repo: RepositoryModel;
    list?: CodeRef[];
    index?: number;
}) {
    return <CodeReference documentation reference={reference} repo={repo} list={list} index={index} />;
}

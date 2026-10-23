import { CodeReference } from '../../shared/ui/CodeReference';
import type { CodeRef } from '../../models/types';
import type { RepositoryModel } from '../../models/RepositoryModel';

export function DocumentationReference({
    reference,
    repo,
}: {
    reference: CodeRef;
    repo: RepositoryModel;
}) {
    return <CodeReference documentation reference={reference} repo={repo} />;
}

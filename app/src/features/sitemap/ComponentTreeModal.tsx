import { useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import type { ComponentNode } from '../../models/types';
import type { SitemapViewModel } from './SitemapViewModel';

const countNodes = (nodes: ComponentNode[]): number => nodes.reduce((n, node) => n + 1 + countNodes(node.children), 0);

/** One component and what it renders; clicking it opens it on the Components diagram. */
const ComponentRow = observer(function ComponentRow({ vm, node, screen }: { vm: SitemapViewModel; node: ComponentNode; screen: string }) {
    const { component } = node;
    return (
        <li>
            <button className="component-row" type="button" title={component.detail || undefined}
                aria-label={'Show ' + component.label + ' in the Components diagram'} onClick={() => vm.showComponent(screen, node.id)}>
                <b>{component.label}</b>
                {component.tags.map((tag) => <span key={tag} className="component-tag">{tag}</span>)}
                {node.repeat && <span className="hint"> · shown above</span>}
                {node.more > 0 && <span className="hint"> · +{node.more} more</span>}
            </button>
            {node.children.length > 0 && <ul>{node.children.map((child) => <ComponentRow key={child.id} vm={vm} node={child} screen={screen} />)}</ul>}
        </li>
    );
});

/** A screen's component tree, opened from the screen panel's View component tree. */
const ComponentTreeModal = observer(function ComponentTreeModal({ vm }: { vm: SitemapViewModel }) {
    const dialog = useRef<HTMLDialogElement>(null);
    const id = vm.treeScreenId;
    useEffect(() => {
        if (id && !dialog.current?.open) dialog.current?.showModal?.();
        else if (!id && dialog.current?.open) dialog.current.close();
    }, [id]);
    const trees = id ? vm.componentTrees(id) : [];
    return (
        <dialog ref={dialog} id="component-tree-dialog" className="modal" aria-labelledby="component-tree-title"
            onClose={vm.closeComponentTree} onCancel={vm.closeComponentTree}>
            {id && <>
                <ModalHeader titleId="component-tree-title" closeId="component-tree-close" onClose={vm.closeComponentTree}
                    title={vm.screenLabel(id) + ' components'}
                    actions={<button className="btn" id="component-tree-diagram" type="button" onClick={vm.showTreeInDiagram}>Show in diagram</button>} />
                <div className="modal-body">
                    {trees.length ? <ul className="component-tree" aria-label="Components on this screen">
                        {trees.map((node) => <ComponentRow key={node.id} vm={vm} node={node} screen={id} />)}
                    </ul> : <p className="hint">No components were linked to this screen.</p>}
                </div>
            </>}
        </dialog>
    );
});

export { ComponentTreeModal, countNodes };

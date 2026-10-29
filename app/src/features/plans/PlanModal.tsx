import { useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import type { PlansViewModel } from './PlansViewModel';
export const PlanModal = observer(function PlanModal({ vm }: { vm: PlansViewModel }) {
    const dialog = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        if (vm.isOpen && !dialog.current?.open) dialog.current?.showModal();
        else if (!vm.isOpen && dialog.current?.open) dialog.current.close();
    }, [vm.isOpen]);
    const plan = vm.plan;
    return (
        <dialog
            ref={dialog}
            id="plan-dialog"
            className="modal"
            aria-labelledby="plan-title"
            onClose={vm.close}
            onCancel={vm.close}
        >
            <ModalHeader titleId="plan-title" title="Implementation plan" closeId="plan-close" onClose={vm.close}
                actions={<>
                    <button
                        className={'btn' + (vm.busy ? ' busy' : '')}
                        id="plan-generate"
                        type="button"
                        aria-busy={vm.busy}
                        disabled={vm.busy || !vm.deps.repo.aiAvailable}
                        onClick={() => void vm.generatePlan()}
                    >
                        {vm.busy ? (plan ? 'Regenerating…' : 'Generating…') : plan ? 'Regenerate' : 'Retry'}
                    </button>
                    <button
                        className="btn"
                        id="plan-stop"
                        type="button"
                        hidden={!vm.busy}
                        onClick={vm.stop}
                    >
                        Stop
                    </button>
                    <button
                        className="btn"
                        id="plan-copy"
                        type="button"
                        hidden={!plan}
                        onClick={() => void vm.copy()}
                    >
                        {vm.copied.copied ? 'Copied!' : 'Copy'}
                    </button>
                </>} />
            <div className="modal-body plan-content">
                <p
                    id="plan-status"
                    className={'status' + (vm.busy ? ' busy' : '') + (vm.error ? ' err' : '')}
                    role="status"
                >
                    {vm.status}
                </p>
                <div id="plan-body">
                    {plan && (
                        <>
                            <p>{plan.summary}</p>
                            <ol>
                                {plan.tasks.map((task, i) => (
                                    <li key={i}>
                                        <h3>{task.title}</h3>
                                        <p>{task.detail}</p>
                                        {task.files.length > 0 && (
                                            <p className="plan-files">{task.files.join(' · ')}</p>
                                        )}
                                    </li>
                                ))}
                            </ol>
                            {(['interfaces', 'tests', 'risks', 'questions'] as const).map(
                                (k) =>
                                    plan[k].length > 0 && (
                                        <section key={k}>
                                            <h3>
                                                {
                                                    {
                                                        interfaces: 'Interface changes',
                                                        tests: 'Tests',
                                                        risks: 'Risks',
                                                        questions: 'Open questions',
                                                    }[k]
                                                }
                                            </h3>
                                            <ul>
                                                {plan[k].map((s, i) => (
                                                    <li key={i}>{s}</li>
                                                ))}
                                            </ul>
                                        </section>
                                    )
                            )}
                        </>
                    )}
                </div>
            </div>
        </dialog>
    );
});

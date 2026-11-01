import { useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { Disclosure, DisclosureList } from '../../shared/ui/Disclosure';
import { SECTIONS, SECTION_KEYS, type PlansViewModel } from './PlansViewModel';
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
                            {plan.summary && (
                                <>
                                    <h3 className="plan-summary-title">Summary</h3>
                                    <p>{plan.summary}</p>
                                </>
                            )}
                            <DisclosureList className="plan-sections">
                                <Disclosure id="plan-steps" title="Steps" count={`${vm.progress.done}/${vm.progress.total}`}
                                    countClassName={vm.progress.done === vm.progress.total ? 'all-done' : undefined}
                                    open={!vm.stepsClosed} onToggle={vm.setStepsOpen}>
                                    <ol className="plan-steps">
                                        {plan.tasks.map((task, i) => {
                                            const done = !!task.done,
                                                open = !done || vm.isExpanded(i),
                                                bodyId = `plan-step-${i}`;
                                            return (
                                                <li key={i} className={'plan-step' + (done ? ' done' : '')}>
                                                    <div className="plan-step-head">
                                                        <i className="step-number" aria-hidden="true">{i + 1}</i>
                                                        <h3>
                                                            {done ? (
                                                                <button type="button" className="plan-step-title" aria-expanded={open}
                                                                    aria-controls={bodyId} onClick={() => vm.toggleExpanded(i)}>
                                                                    {task.title}
                                                                </button>
                                                            ) : task.title}
                                                        </h3>
                                                        <label className="plan-step-done">
                                                            <input type="checkbox" checked={done} disabled={vm.busy}
                                                                aria-label={`Step ${i + 1} done`}
                                                                onChange={() => void vm.toggleDone(i)} />
                                                            Done
                                                        </label>
                                                    </div>
                                                    {open && (
                                                        <div className="plan-step-body" id={bodyId}>
                                                            <p>{task.detail}</p>
                                                            {task.files.length > 0 && (
                                                                <p className="plan-files">{task.files.join(' · ')}</p>
                                                            )}
                                                        </div>
                                                    )}
                                                </li>
                                            );
                                        })}
                                    </ol>
                                </Disclosure>
                                {SECTION_KEYS.filter((k) => plan[k].length > 0).map((k) => (
                                    <Disclosure key={k} id={'plan-' + k} title={SECTIONS[k]} count={plan[k].length}
                                        open={vm.isSectionOpen(k)} onToggle={(open) => vm.setSectionOpen(k, open)}>
                                        <ul>
                                            {plan[k].map((s, i) => (
                                                <li key={i}>{s}</li>
                                            ))}
                                        </ul>
                                    </Disclosure>
                                ))}
                            </DisclosureList>
                        </>
                    )}
                </div>
            </div>
        </dialog>
    );
});

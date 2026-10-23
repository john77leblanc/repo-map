import { useEffect, useRef, useState } from 'react';
import type { Agent, AgentPick } from '../../models/types';

export interface AgentPickerProps {
    prefix: string;
    agents: Agent[];
    value: AgentPick | null;
    onChange: (pick: AgentPick | null) => void;
    onRefresh: () => void;
    loading?: boolean;
    hidden?: boolean;
    inheritLabel?: string;
    label?: string;
}
export const validModel = (value: string) =>
    /^[\w.:\/@+-]{1,120}$/.test(value) && !value.startsWith('-');
export function AgentPicker({
    prefix,
    agents,
    value: incoming,
    onChange,
    onRefresh,
    loading = false,
    hidden = false,
    inheritLabel,
    label = 'AI tool and model',
}: AgentPickerProps) {
    const [pending, setPending] = useState<AgentPick | null>(null);
    const value = pending || incoming;
    const [custom, setCustom] = useState(false);
    useEffect(() => {
        setPending(null);
        setCustom(false);
    }, [incoming?.agent, incoming?.model]);
    const [draft, setDraft] = useState(value?.model || '');
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const input = useRef<HTMLInputElement>(null);
    const agent = agents.find((a) => a.id === value?.agent && a.available);
    const known =
        !value?.model ||
        value.model === agent?.defaultModel ||
        agent?.models.some((m) => m.id === value.model);
    const isCustom = custom || !known;
    const efforts =
        agent?.models.find((m) => m.id === (value?.model || agent.defaultModel))?.efforts ||
        agent?.efforts ||
        [];
    useEffect(() => {
        clearTimeout(timer.current);
        setDraft(value?.model || '');
    }, [value?.agent, value?.model]);
    useEffect(() => () => clearTimeout(timer.current), []);
    const normalized = (pick: AgentPick) => {
        const a = agents.find((a) => a.id === pick.agent);
        const es =
            a?.models.find((m) => m.id === (pick.model || a.defaultModel))?.efforts ||
            a?.efforts ||
            [];
        return { ...pick, effort: es.includes(pick.effort || '') ? pick.effort : '' };
    };
    const selected = value?.agent
        ? JSON.stringify([
              value.agent,
              isCustom ? '*' : value.model === agent?.defaultModel ? '' : value.model || '',
          ])
        : '';
    return (
        <>
            <div className="row" hidden={hidden}>
                <span className="pick" id={prefix} hidden={hidden}>
                    <select
                        id={prefix + '-agent'}
                        aria-label={label}
                        title={label}
                        value={selected}
                        onChange={(e) => {
                            clearTimeout(timer.current);
                            if (!e.target.value) {
                                setPending(null);
                                setCustom(false);
                                onChange(null);
                                return;
                            }
                            const [id, model] = JSON.parse(e.target.value) as [string, string];
                            const prev = value?.agent === id ? value : null;
                            setCustom(model === '*');
                            const next = normalized({
                                agent: id,
                                model: model === '*' ? prev?.model || '' : model,
                                effort: prev?.effort || '',
                            });
                            setDraft(next.model || '');
                            if (model !== '*' || next.model) onChange(next);
                            else setPending(next);
                            if (model === '*') setTimeout(() => input.current?.focus(), 0);
                        }}
                    >
                        {inheritLabel && <option value="">{inheritLabel}</option>}
                        {agents.map((a) => (
                            <optgroup
                                key={a.id}
                                label={a.label + (a.available ? '' : ' (unavailable)')}
                                disabled={!a.available}
                            >
                                {!a.available ? (
                                    <option disabled>{a.reason || 'Not available'}</option>
                                ) : (
                                    <>
                                        <option value={JSON.stringify([a.id, ''])}>
                                            {a.label} · {a.defaultModel || 'default model'}
                                        </option>
                                        {a.models
                                            .filter((m) => m.id !== a.defaultModel)
                                            .map((m) => (
                                                <option
                                                    key={m.id}
                                                    value={JSON.stringify([a.id, m.id])}
                                                >
                                                    {a.label} · {m.label || m.id}
                                                </option>
                                            ))}
                                        <option value={JSON.stringify([a.id, '*'])}>
                                            {a.label} · custom model…
                                        </option>
                                    </>
                                )}
                            </optgroup>
                        ))}
                    </select>
                    <select
                        id={prefix + '-effort'}
                        aria-label={'Effort for ' + (prefix === 'mpick' ? 'the map' : 'traces')}
                        title="How hard the AI tool works. Higher is slower and uses more of your plan or credits."
                        hidden={!efforts.length}
                        value={value?.effort || ''}
                        onChange={(e) => {
                            if (value) {
                                const next = { ...value, effort: e.target.value };
                                if (pending) setPending(next);
                                else onChange(next);
                            }
                        }}
                    >
                        <option value="">effort</option>
                        {efforts.map((e) => (
                            <option key={e} value={e}>
                                {e}
                            </option>
                        ))}
                    </select>
                    <button
                        className={
                            prefix === 'tpick' ? 'btn sm' : 'iconbtn' + (loading ? ' busy' : '')
                        }
                        id={prefix + '-refresh'}
                        type="button"
                        disabled={loading}
                        title="Look for AI tools and models again"
                        aria-label={
                            prefix === 'tpick'
                                ? 'Refresh trace tools'
                                : 'Look for AI tools and models again'
                        }
                        onClick={onRefresh}
                    >
                        {prefix === 'tpick' ? (
                            'Refresh'
                        ) : (
                            <svg viewBox="0 0 16 16">
                                <path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5v3h-3" />
                            </svg>
                        )}
                    </button>
                </span>
            </div>
            <input
                ref={input}
                className="pickin"
                id={prefix + '-custom'}
                type="text"
                placeholder={prefix === 'mpick' ? 'Model id, e.g. gpt-5' : 'Model id'}
                aria-label={prefix === 'mpick' ? 'Model id for the map' : 'Custom model for traces'}
                spellCheck={false}
                autoComplete="off"
                hidden={hidden || !isCustom}
                aria-invalid={!!draft && !validModel(draft.trim())}
                value={draft}
                onChange={(e) => {
                    const text = e.target.value;
                    setDraft(text);
                    clearTimeout(timer.current);
                    if (value && validModel(text.trim())) {
                        const next = normalized({ ...value, model: text.trim() });
                        timer.current = setTimeout(() => {
                            setPending(null);
                            onChange(next);
                        }, 500);
                    }
                }}
            />
        </>
    );
}

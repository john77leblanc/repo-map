import { useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import type { ComboboxModel } from '../../models/ComboboxModel';

export interface ComboboxProps {
    model: ComboboxModel;
    /** Id of the text field (its `<label htmlFor>` names the combobox). */
    id: string;
    placeholder?: string;
    disabled?: boolean;
    /** Shown in the list when nothing matches, e.g. "No branches match". */
    empty?: string;
    /** Name for the ▾ button, e.g. "Show branches". */
    toggleLabel?: string;
}

/**
 * A text field with a filterable list of suggestions (ARIA combobox). Type to
 * filter, ↑/↓ to move, Enter to choose, Escape to close. Free text is kept.
 */
export const Combobox = observer(function Combobox({ model, id, placeholder, disabled, empty = 'No matches', toggleLabel = 'Show suggestions' }: ComboboxProps) {
    const root = useRef<HTMLDivElement>(null);
    const list = id + '-list';
    const optionId = (i: number) => `${id}-opt-${i}`;
    // A click outside closes the list.
    useEffect(() => {
        if (!model.open) return;
        const onDown = (e: MouseEvent) => {
            if (!root.current?.contains(e.target as Node)) model.close();
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [model.open, model]);
    // Keep the active option in view.
    useEffect(() => {
        if (model.active >= 0) document.getElementById(optionId(model.active))?.scrollIntoView?.({ block: 'nearest' });
    }, [model.active]);
    return (
        <div className={'combobox' + (model.open ? ' open' : '')} ref={root}>
            <input id={id} role="combobox" autoComplete="off" spellCheck={false} value={model.value} placeholder={placeholder} disabled={disabled}
                aria-expanded={model.open} aria-controls={list} aria-autocomplete="list"
                aria-activedescendant={model.open && model.active >= 0 ? optionId(model.active) : undefined}
                onChange={(e) => model.type(e.target.value)}
                onClick={model.show}
                onBlur={(e) => { if (!root.current?.contains(e.relatedTarget as Node)) model.close(); }}
                onKeyDown={(e) => {
                    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                        e.preventDefault();
                        model.move(e.key === 'ArrowDown' ? 1 : -1);
                    } else if (e.key === 'Enter' && model.open && model.activeOption) {
                        // choose the option rather than submit the form
                        e.preventDefault();
                        model.choose();
                    } else if (e.key === 'Escape' && model.open) {
                        // close the list, not the dialog
                        e.preventDefault();
                        e.stopPropagation();
                        model.close();
                    }
                }} />
            <button className="combobox-toggle" type="button" tabIndex={-1} aria-label={toggleLabel} disabled={disabled}
                aria-controls={list} aria-expanded={model.open} onClick={model.toggle}>
                <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5l3 3 3-3" /></svg>
            </button>
            {model.open && (
                <div className="combobox-list" id={list} role="listbox" aria-label={toggleLabel}>
                    {model.groups.map((g) => (
                        <div role="group" aria-label={g.group} key={g.group}>
                            <div className="combobox-group" aria-hidden="true">{g.group}</div>
                            {g.options.map(({ option, index }) => (
                                <div key={option.group + option.value} id={optionId(index)} role="option" aria-selected={index === model.active}
                                    className={'combobox-option' + (index === model.active ? ' active' : '') + (option.muted ? ' muted' : '')}
                                    title={option.title}
                                    // mousedown keeps focus in the field
                                    onMouseDown={(e) => { e.preventDefault(); model.choose(option); }}>
                                    <span className="combobox-label">{option.label}</span>
                                    {option.meta && <span className="combobox-meta">{option.meta}</span>}
                                </div>
                            ))}
                        </div>
                    ))}
                    {!model.filtered.length && <div className="combobox-empty">{empty}</div>}
                    {model.hidden > 0 && <div className="combobox-empty">{model.hidden} more; type to narrow the list.</div>}
                </div>
            )}
        </div>
    );
});

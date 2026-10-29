import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { SettingsSection } from '../../shared/ui/SettingsSection';
import type { TraceViewModel } from './TraceViewModel';

function OutputOption({ id, label, description, checked, disabled, onChange }: {
    id: string;
    label: string;
    description: string;
    checked: boolean;
    disabled?: boolean;
    onChange(value: boolean): void;
}) {
    const [helpOpen, setHelpOpen] = useState(false);
    return (
        <div className="output-option">
            <label className="opt" htmlFor={id}>
                <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
                {label}
            </label>
            <span className="output-help" onMouseEnter={() => setHelpOpen(true)} onMouseLeave={() => setHelpOpen(false)}>
                <button className="output-help-button" type="button" aria-label={'About ' + label}
                    aria-describedby={id + '-help'} onFocus={() => setHelpOpen(true)} onBlur={() => setHelpOpen(false)}
                    onClick={() => setHelpOpen(true)} onKeyDown={(e) => {
                        if (e.key === 'Escape' && helpOpen) {
                            e.preventDefault();
                            e.stopPropagation();
                            setHelpOpen(false);
                        }
                    }}>
                    <span aria-hidden="true">?</span>
                </button>
                <span id={id + '-help'} className="output-tooltip" role="tooltip" hidden={!helpOpen}>{description}</span>
            </span>
        </div>
    );
}

export interface OutputsSectionProps {
    vm: TraceViewModel;
    open: boolean;
    onToggle(open: boolean): void;
    /** How many outputs are selected, shown in the title row. */
    count: number;
    /** On the review tabs Code architecture is always on: a review's files are grouped by card. */
    review?: boolean;
    disabled?: boolean;
}

/** The Outputs choice (Code architecture, Flowchart, Sitemap) as a collapsible section with a count. */
export const OutputsSection = observer(function OutputsSection({ vm, open, onToggle, count, review = false, disabled = false }: OutputsSectionProps) {
    const sitemap = vm.deps.sitemap;
    return (
        <div className="trace-outputs">
            <SettingsSection id="trace-outputs" title="Outputs" count={count} open={open} onToggle={onToggle}>
                <fieldset className="output-options" disabled={disabled} aria-label="Outputs">
                    <OutputOption id="witharchitecture" label="Code architecture" checked={review || vm.architecture} disabled={review}
                        description={review ? 'Reviews always show changes on the map, with the changed files under each card.' : 'Highlights the process on the repository map.'}
                        onChange={(value) => vm.setOutput('architecture', value)} />
                    {review && <p className="hint output-note">Reviews always show changes on the map.</p>}
                    <OutputOption id="withflow" label="Flowchart" checked={vm.flowchart}
                        description={review ? 'Shows the process the change alters, with what it adds, changes or removes.' : 'Shows decisions and outcomes in the process.'}
                        onChange={(value) => vm.setOutput('flowchart', value)} />
                    <OutputOption id="withsitemap" label="Sitemap" checked={vm.sitemap}
                        description={review ? 'Shows the screens and navigation the change adds, changes or removes.' : 'Follows screens and navigation, including proposed changes.'}
                        onChange={(value) => vm.setOutput('sitemap', value)} />
                    {vm.sitemap && sitemap && !sitemap.sitemap && <div>
                        <p>Generate the repository sitemap before {review ? 'reviewing' : 'tracing'} screens. Your {review ? 'choices' : 'question'} will stay here.</p>
                        <button className="btn" type="button" disabled={sitemap.busy || sitemap.loading}
                            onClick={() => void sitemap.generate()}>Generate sitemap</button>
                        {sitemap.busy && <button className="btn" type="button" onClick={sitemap.stop}>Stop sitemap generation</button>}
                        <p role="status">{sitemap.message}</p>
                    </div>}
                </fieldset>
            </SettingsSection>
        </div>
    );
});

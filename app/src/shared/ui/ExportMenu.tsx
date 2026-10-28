import { useEffect, useState } from 'react';
import { DiagramMore } from './DiagramMore';

/** One **Export** button that opens Copy Mermaid and Download SVG. */
function ExportMenu({ prefix, available, copied, onCopy, onDownload }: {
    prefix: string;
    available: boolean;
    copied: boolean;
    onCopy: () => void;
    onDownload: () => void;
}) {
    // Popover open state is view-local, like focus: nothing else reads it.
    const [open, setOpen] = useState(false);
    useEffect(() => { if (!available) setOpen(false); }, [available]);
    return (
        <DiagramMore id={prefix + '-export-menu'} triggerId={prefix + '-export'} open={open} setOpen={setOpen}
            disabled={!available} panelLabel="Export" label={<>{copied ? 'Copied!' : 'Export'} <span aria-hidden="true">▾</span></>}
            actions={[
                { id: prefix + '-mermaid', label: 'Copy Mermaid', run: onCopy,
                    title: 'Mermaid source, for GitHub, GitLab, Notion and other Markdown tools' },
                { id: prefix + '-svg', label: 'Download SVG', run: onDownload },
            ]} />
    );
}

export { ExportMenu };

import { useEffect, useState } from 'react';
import { DiagramMore } from './DiagramMore';
import type { ExportFormat } from '../diagramExport';

const FORMATS: { format: ExportFormat; label: string; title: string }[] = [
    { format: 'svg', label: 'Download SVG', title: 'Vector image, for docs and design tools' },
    { format: 'png', label: 'Download PNG', title: 'Image, for chat, slides and tickets' },
    { format: 'pdf', label: 'Download PDF', title: 'Vector, one page sized to the diagram' },
    { format: 'html', label: 'Download HTML', title: 'One self-contained page with zoom; works offline' },
];

/** One **Export** button that opens Copy Mermaid and the file downloads. */
function ExportMenu({ prefix, available, copied, exporting, onCopy, onDownload }: {
    prefix: string;
    available: boolean;
    copied: boolean;
    /** The format being built, which disables the menu meanwhile. */
    exporting?: ExportFormat | null;
    onCopy: () => void;
    onDownload: (format: ExportFormat) => void;
}) {
    // Popover open state is view-local, like focus: nothing else reads it.
    const [open, setOpen] = useState(false);
    useEffect(() => { if (!available) setOpen(false); }, [available]);
    const label = exporting ? 'Exporting…' : copied ? 'Copied!' : 'Export';
    return (
        <DiagramMore id={prefix + '-export-menu'} triggerId={prefix + '-export'} open={open} setOpen={setOpen}
            disabled={!available || !!exporting} panelLabel="Export" label={<>{label} <span aria-hidden="true">▾</span></>}
            actions={[
                { id: prefix + '-mermaid', label: 'Copy Mermaid', run: onCopy,
                    title: 'Mermaid source, for GitHub, GitLab, Notion and other Markdown tools' },
                ...FORMATS.map(({ format, label, title }) => ({ id: `${prefix}-${format}`, label, title, run: () => onDownload(format) })),
            ]} />
    );
}

export { ExportMenu };

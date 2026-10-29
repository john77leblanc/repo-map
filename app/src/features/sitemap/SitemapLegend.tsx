function SitemapLegend({ open, trace, proposal, review = false }: { open: boolean; trace: boolean; proposal: boolean; review?: boolean }) {
    return (
        <section className="flegend" id="sitemap-key" aria-label="Diagram key" hidden={!open}>
            <div>
                <span><svg viewBox="0 0 22 14" aria-hidden="true"><rect className="lg" x="1" y="2" width="20" height="10" rx="2" /></svg>screen</span>
                <span><svg viewBox="0 0 22 14" aria-hidden="true"><path className="lg sitemap-key-arrow" d="M1 7H20M15 3L20 7L15 11" /></svg>navigation found in code</span>
                {trace && <>
                    <span><b>1, 2.</b> journey step numbers</span>
                    <span><svg viewBox="0 0 22 14" aria-hidden="true"><rect className="lg sitemap-key-context" x="1" y="2" width="20" height="10" rx="2" /></svg>dimmed: surrounding context</span>
                </>}
            </div>
            <p data-proposal-key className="proposal-legend" hidden={!proposal}>
                {review ? 'Changes in this review:' : 'Proposed changes:'} <span className="key-change">New</span>{' '}
                <span className="key-change modified">Modified</span>{' '}
                <span className="key-change removed">Removed</span>{review ? '.' : '. Proposed changes are not implemented code.'}
            </p>
        </section>
    );
}

export { SitemapLegend };

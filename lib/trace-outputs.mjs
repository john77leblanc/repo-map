import { normalizeFlow } from './flow.mjs';
import { normalizeSitemapTrace } from './sitemap-trace.mjs';

/** Output availability, including saved traces made before output selection existed. */
function traceOutputs(trace) {
    const flowchart = !!normalizeFlow(trace.flow);
    return {
        architecture: trace.outputs ? trace.outputs.architecture === true : true,
        flowchart: flowchart && (trace.outputs ? trace.outputs.flowchart === true : true),
        ...(trace.sitemap || trace.outputs?.sitemap !== undefined ? {
            sitemap: !!normalizeSitemapTrace(trace.sitemap, null, trace.intent) && trace.outputs?.sitemap !== false,
        } : {}),
    };
}

export { traceOutputs };

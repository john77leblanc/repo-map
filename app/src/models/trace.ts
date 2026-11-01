import { normalizeFlow } from '../../../lib/flow.mjs';
import { normalizeExpansions } from '../../../lib/flow-expand.mjs';
import { normalizePlan, normalizeProposal } from '../../../lib/proposal.mjs';
import { normalizeReview } from '../../../lib/review-data.mjs';
import { traceOutputs } from '../../../lib/trace-outputs.mjs';
import { normalizeSitemapTrace } from '../../../lib/sitemap-trace.mjs';
import { normalizeComponentsTrace } from '../../../lib/components-trace.mjs';
import type { CodeRef, ComponentsTrace, Flow, Plan, Proposal, RepoMap, Review, StreamResult, Trace, SitemapTrace } from './types';

type PlainTrace = Omit<Trace, 'pairs' | '_doc' | 'key' | 'createdAt'>;
type TraceStep = Trace['steps'][number];
/** The workspace's merged map, with placeholder cards that seams replaced (old id -> real id). */
type WorkspaceMap = RepoMap & { replaced?: Record<string, string> };

const LINKED_ID = /^([a-z][a-z0-9-]{1,30}):/;
const SHA = /^[0-9a-f]{7,40}$/i;

/** Proposals and reviews carry changes to the map; descriptions don't. */
function hasChanges(trace: Pick<Trace, 'intent'> | null | undefined): boolean {
    return trace?.intent === 'proposal' || trace?.intent === 'review';
}

/** The linked repo a prefixed id or path belongs to, or '' for this repo. */
function linkOf(id: string): string {
    return id.match(LINKED_ID)?.[1] || '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
    return isRecord(value) ? value : {};
}

function array(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function cleanRefs(value: unknown, steps: readonly TraceStep[]): CodeRef[] | null {
    if (!Array.isArray(value)) return null;
    const ids = new Set(steps.map((step) => step.id));
    return array(value)
        .map((item): CodeRef => {
            const ref = record(item);
            const start = Math.max(1, parseInt(String(ref.start)) || 1);
            const end = Math.max(1, parseInt(String(ref.end)) || 1);
            return {
                step: String(ref.step || ''),
                path: String(ref.path || '').replace(/^\/+/, ''),
                start,
                end: Math.max(start, end),
                why: String(ref.why || '').slice(0, 300),
                ...(SHA.test(String(ref.rev || '')) ? { rev: String(ref.rev).toLowerCase() } : {}),
            };
        })
        .filter((ref) => ids.has(ref.step || '') && ref.path && !/(^|\/)\.\.(\/|$)/.test(ref.path))
        .slice(0, 20);
}

/**
 * Clean a trace from the AI tool, a saved file or a shared code. A workspace
 * trace is checked against `workspace` (the merged map) when it is loaded;
 * steps in a repo that is no longer linked are kept, so they can be shown as missing.
 */
function normalizeTrace(value: unknown, homeMap: RepoMap, prompt?: string, workspace?: WorkspaceMap | null): Trace {
    if (!isRecord(value)) throw new Error('no trace');
    const raw = value;
    const intent = raw.intent === 'proposal' || raw.intent === 'review' ? raw.intent : 'description';
    const scope = raw.scope === 'workspace' && intent === 'description' ? 'workspace' : undefined;
    const map: WorkspaceMap = scope && workspace ? workspace : homeMap;
    const replaced = map.replaced || {};
    const swap = (id: string) => replaced[id] || id;
    // These shared JS normalizers validate and construct their output schemas.
    const proposal =
        intent !== 'description' ? (normalizeProposal(raw.proposal, map) as Proposal) : null;
    const known = new Set(map.nodes.map((node) => node.id));
    proposal?.nodes.forEach((node) => known.add(node.id));
    const repos = new Set(map.nodes.map((node) => linkOf(node.id)));
    // A prefixed id from a repo that isn't in the map any more: kept, shown as not linked.
    const unlinked = (id: string) => !!scope && !!linkOf(id) && !repos.has(linkOf(id));
    const rawSteps = array(raw.steps).map(record);
    const seen = new Set<string>();
    const steps: TraceStep[] = rawSteps
        .slice(0, 40)
        .map((step) => ({
            id: swap(String(step.id || '').trim()),
            note: String(step.note || '').slice(0, 4000),
        }))
        .filter((step) => {
            if ((!known.has(step.id) && !unlinked(step.id)) || seen.has(step.id)) return false;
            seen.add(step.id);
            return true;
        });
    const sitemap = normalizeSitemapTrace(raw.sitemap, null, intent) as SitemapTrace | null;
    const components = normalizeComponentsTrace(raw.components, null, intent) as ComponentsTrace | null;
    if (!steps.length && !sitemap && !components && !normalizeFlow(raw.flow)) throw new Error('no known services');

    // Saved refs are flat; fresh AI results may nest them under each step.
    const refs: unknown[] = Array.isArray(raw.refs)
        ? array(raw.refs)
        : rawSteps.flatMap((step) =>
              array(step.refs).map((item) => {
                  const ref = record(item);
                  return {
                      step: swap(String(step.id || '').trim()),
                      path: ref.path,
                      start: ref.start,
                      end: ref.end,
                      why: ref.why,
                      rev: ref.rev,
                  };
              })
          );
    const pairs = new Set<string>();
    const allowed = new Set(map.edges.map((edge) => edge.from + '|' + edge.to));
    proposal?.edges.forEach((edge) => allowed.add(edge.from + '|' + edge.to));
    const addPair = (from: string, to: string) => {
        if (allowed.has(from + '|' + to)) pairs.add(from + '|' + to);
        else if (intent === 'description' && allowed.has(to + '|' + from))
            pairs.add(to + '|' + from);
    };
    for (const pair of array(raw.edges)) {
        if (!Array.isArray(pair)) continue;
        const endpoints = array(pair);
        addPair(swap(String(endpoints[0])), swap(String(endpoints[1])));
    }
    for (let i = 1; i < steps.length; i++) addPair(steps[i - 1].id, steps[i].id);
    proposal?.edges.forEach((edge) => pairs.add(edge.from + '|' + edge.to));

    const flow = normalizeFlow(raw.flow, rawSteps.length) as Flow | null;
    flow?.nodes.forEach((node) => {
        if (!node.step) return;
        const id = swap(String(rawSteps[node.step - 1]?.id || ''));
        const index = steps.findIndex((step) => step.id === id);
        if (index < 0) delete node.step;
        else node.step = index + 1;
    });
    return {
        intent,
        proposal,
        plan: intent === 'proposal' ? (normalizePlan(raw.plan) as Plan | null) : null,
        ...(intent === 'review' ? { review: normalizeReview(raw.review, known) as Review | null } : {}),
        title: String(raw.title || 'Untitled trace').slice(0, 80),
        prompt: String(prompt || raw.prompt || '').slice(0, 4000),
        summary: String(raw.summary || ''),
        gaps: String(raw.gaps || ''),
        steps,
        edges: [...pairs].map((pair) => pair.split('|')),
        pairs,
        refs: cleanRefs(refs.map((r) => (isRecord(r) ? { ...r, step: swap(String(r.step || '')) } : r)), steps) || [],
        flow,
        ...(flow && raw.expansions ? { expansions: normalizeExpansions(raw.expansions, flow) as Trace['expansions'] } : {}),
        sitemap,
        pendingSitemap: raw.pendingSitemap === true,
        components,
        pendingComponents: raw.pendingComponents === true,
        outputs: traceOutputs(raw),
        pendingFlow: raw.pendingFlow === true,
        used: cleanUsed(raw.used),
        ...(scope ? { scope, repos: array(raw.repos).map(String).filter((r) => r === 'home' || LINKED_ID.test(r + ':')).slice(0, 12) } : {}),
    };
}

/** Agent metadata travels in trace codes as information only. */
function cleanUsed(value: unknown): Trace['used'] {
    if (!isRecord(value)) return null;
    const text = (input: unknown, limit: number): string => String(input || '').slice(0, limit);
    return {
        agent: text(value.agent, 40),
        model: text(value.model, 120),
        effort: text(value.effort, 32),
        label: text(value.label, 160),
    };
}

function plain(trace: Trace): PlainTrace {
    const result: PlainTrace = {
        intent: trace.intent || 'description',
        outputs: traceOutputs(trace),
        pendingFlow: trace.pendingFlow === true,
        title: trace.title,
        prompt: trace.prompt,
        summary: trace.summary,
        gaps: trace.gaps,
        steps: trace.steps,
        edges: trace.edges,
        refs: trace.refs || [],
    };
    if (trace.proposal) result.proposal = trace.proposal;
    if (trace.plan) result.plan = trace.plan;
    if (trace.review) result.review = trace.review;
    if (trace.flow) result.flow = trace.flow;
    if (trace.flow && trace.expansions && Object.keys(trace.expansions).length) result.expansions = trace.expansions;
    if (trace.sitemap) result.sitemap = trace.sitemap;
    if (trace.pendingSitemap) result.pendingSitemap = true;
    if (trace.components) result.components = trace.components;
    if (trace.pendingComponents) result.pendingComponents = true;
    if (trace.used) result.used = trace.used;
    if (trace.scope) {
        result.scope = trace.scope;
        result.repos = trace.repos || [];
    }
    return result;
}

function encodeTrace(trace: Trace): string {
    return 'rmap1:' + btoa(unescape(encodeURIComponent(JSON.stringify(plain(trace)))));
}

function decodeTrace(code: string, map: RepoMap, workspace?: WorkspaceMap | null): Trace {
    const text = code.trim();
    const prefix = text.match(/^(rmap1|msmap1):/);
    if (!prefix) throw new Error('prefix');
    const raw: unknown = JSON.parse(decodeURIComponent(escape(atob(text.slice(prefix[0].length)))));
    return normalizeTrace(raw, map, undefined, workspace);
}

function spend(result: StreamResult): string {
    if (result.cost) return ' · ' + (result.cost < 0.01 ? '<$0.01' : '$' + result.cost.toFixed(2));
    if (result.tokens) return ' · ' + result.tokens.toLocaleString() + ' tokens';
    return result.spend ? ' · ' + String(result.spend) : '';
}

export { hasChanges, normalizeTrace, plain, encodeTrace, decodeTrace, cleanRefs, cleanUsed, linkOf, spend };
export type { PlainTrace, WorkspaceMap };

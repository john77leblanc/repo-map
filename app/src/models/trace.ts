import { normalizeFlow } from '../../../lib/flow.mjs';
import { normalizePlan, normalizeProposal } from '../../../lib/proposal.mjs';
import { traceOutputs } from '../../../lib/trace-outputs.mjs';
import type { CodeRef, Flow, Plan, Proposal, RepoMap, StreamResult, Trace } from './types';

type PlainTrace = Omit<Trace, 'pairs' | '_doc' | 'key' | 'createdAt'>;
type TraceStep = Trace['steps'][number];

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
            };
        })
        .filter((ref) => ids.has(ref.step || '') && ref.path && !/(^|\/)\.\.(\/|$)/.test(ref.path))
        .slice(0, 20);
}

function normalizeTrace(value: unknown, map: RepoMap, prompt?: string): Trace {
    if (!isRecord(value)) throw new Error('no trace');
    const raw = value;
    const intent = raw.intent === 'proposal' ? 'proposal' : 'description';
    // These shared JS normalizers validate and construct their output schemas.
    const proposal =
        intent === 'proposal' ? (normalizeProposal(raw.proposal, map) as Proposal) : null;
    const known = new Set(map.nodes.map((node) => node.id));
    proposal?.nodes.forEach((node) => known.add(node.id));
    const rawSteps = array(raw.steps).map(record);
    const seen = new Set<string>();
    const steps: TraceStep[] = rawSteps
        .slice(0, 40)
        .map((step) => ({
            id: String(step.id || '').trim(),
            note: String(step.note || '').slice(0, 4000),
        }))
        .filter((step) => {
            if (!known.has(step.id) || seen.has(step.id)) return false;
            seen.add(step.id);
            return true;
        });
    if (!steps.length) throw new Error('no known services');

    // Saved refs are flat; fresh AI results may nest them under each step.
    const refs: unknown[] = Array.isArray(raw.refs)
        ? array(raw.refs)
        : rawSteps.flatMap((step) =>
              array(step.refs).map((item) => {
                  const ref = record(item);
                  return {
                      step: step.id,
                      path: ref.path,
                      start: ref.start,
                      end: ref.end,
                      why: ref.why,
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
        addPair(String(endpoints[0]), String(endpoints[1]));
    }
    for (let i = 1; i < steps.length; i++) addPair(steps[i - 1].id, steps[i].id);
    proposal?.edges.forEach((edge) => pairs.add(edge.from + '|' + edge.to));

    const flow = normalizeFlow(raw.flow, rawSteps.length) as Flow | null;
    flow?.nodes.forEach((node) => {
        if (!node.step) return;
        const id = rawSteps[node.step - 1]?.id;
        const index = steps.findIndex((step) => step.id === id);
        if (index < 0) delete node.step;
        else node.step = index + 1;
    });
    return {
        intent,
        proposal,
        plan: intent === 'proposal' ? (normalizePlan(raw.plan) as Plan | null) : null,
        title: String(raw.title || 'Untitled trace').slice(0, 80),
        prompt: String(prompt || raw.prompt || '').slice(0, 4000),
        summary: String(raw.summary || ''),
        gaps: String(raw.gaps || ''),
        steps,
        edges: [...pairs].map((pair) => pair.split('|')),
        pairs,
        refs: cleanRefs(refs, steps) || [],
        flow,
        outputs: traceOutputs(raw),
        pendingFlow: raw.pendingFlow === true,
        used: cleanUsed(raw.used),
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
    if (trace.flow) result.flow = trace.flow;
    if (trace.used) result.used = trace.used;
    return result;
}

function encodeTrace(trace: Trace): string {
    return 'rmap1:' + btoa(unescape(encodeURIComponent(JSON.stringify(plain(trace)))));
}

function decodeTrace(code: string, map: RepoMap): Trace {
    const text = code.trim();
    const prefix = text.match(/^(rmap1|msmap1):/);
    if (!prefix) throw new Error('prefix');
    const raw: unknown = JSON.parse(decodeURIComponent(escape(atob(text.slice(prefix[0].length)))));
    return normalizeTrace(raw, map);
}

function spend(result: StreamResult): string {
    if (result.cost) return ' · ' + (result.cost < 0.01 ? '<$0.01' : '$' + result.cost.toFixed(2));
    if (result.tokens) return ' · ' + result.tokens.toLocaleString() + ' tokens';
    return result.spend ? ' · ' + String(result.spend) : '';
}

export { normalizeTrace, plain, encodeTrace, decodeTrace, cleanRefs, cleanUsed, spend };
export type { PlainTrace };

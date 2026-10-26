/**
 * The "Find seams" AI pass: after contract matching, ask the AI tool for the
 * remaining connections between linked repos. Its answers are proposals: each
 * must join two repos and cite code that exists. Nothing is saved here; the
 * browser saves the ones the person accepts (via 'ai') to workspace.json.
 */
import { runAi, spendText } from './ai/index.mjs';
import { readGuidance } from './guidance.mjs';
import { seamsPrompt } from './prompts.mjs';
import { RESPONSE_SCHEMAS } from './response-contracts.mjs';
import { clampWorkspaceRef, readableLinks, workspaceView } from './workspace.mjs';
import { normalizeSeam, repoOf } from './workspace-map.mjs';

/** Pure part: keep proposals that join known nodes of two repos and aren't already seams. */
function proposedSeams(raw, map) {
    const names = new Set(map.repos.map((r) => r.name));
    const ids = new Set(map.nodes.map((n) => n.id));
    const taken = new Set(map.seams.map((s) => `${s.from}>${s.to}`));
    const out = [];
    for (const item of Array.isArray(raw) ? raw : []) {
        const s = normalizeSeam({ ...item, via: 'ai' });
        if (!s || !ids.has(s.from) || !ids.has(s.to) || repoOf(s.from, names) === repoOf(s.to, names)) continue;
        if (taken.has(`${s.from}>${s.to}`)) continue;
        taken.add(`${s.from}>${s.to}`);
        out.push(s);
    }
    return out;
}

async function findSeams({ root, config, pick, onProgress = () => {}, onStart = () => {} }) {
    const view = await workspaceView(root);
    if (view.repos.filter((r) => !r.error).length < 2) {
        throw Object.assign(new Error('Link another repo first (Settings → Linked repos).'), { code: 'nolinks' });
    }
    const links = await readableLinks(root);
    const t0 = Date.now();
    const run = await runAi({ root, config, task: 'generate', pick, links, maxTurns: 60, responseSchema: RESPONSE_SCHEMAS.seams,
        prompt: seamsPrompt(config, view, { guidance: await readGuidance(root) }), onProgress });
    onStart(run);
    const out = await run.promise;
    onProgress('Checking the code each connection cites…');
    const proposals = [];
    for (const s of proposedSeams(out.value?.seams, view.map)) {
        const refs = [];
        for (const r of s.refs || []) {
            const checked = await clampWorkspaceRef(root, config, r, links);
            if (checked) refs.push({ ...checked, ...(r.why ? { why: r.why } : {}) });
        }
        // every AI seam must point at code that exists
        if (refs.length) proposals.push({ ...s, refs });
    }
    return { proposals, label: run.label, seconds: Math.round((Date.now() - t0) / 1000), spend: spendText(out) };
}

export { findSeams, proposedSeams };

/**
 * Local-only HTTP server: serves the map UI, the repo's config, map and doc
 * links, live file reads from the checkout, AI traces, map jobs (update,
 * redraw, relink docs), the map's AI settings, and saved traces on disk.
 */
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSelection } from './ai/agents.mjs';
import { agentsSummary, providerSummary, runAi } from './ai/index.mjs';
import { MAP_DIR, loadConfig, loadMap } from './config.mjs';
import { mapStatus, markCurrent } from './freshness.mjs';
import { normalizeFlow } from './flow.mjs';
import { RESPONSE_SCHEMAS } from './response-contracts.mjs';
import { flowPrompt, planPrompt, sitemapTracePrompt } from './prompts.mjs';
import { normalizeSitemapTrace } from './sitemap-trace.mjs';
import { normalizePlan, normalizeProposal } from './proposal.mjs';
import { runTrace } from './trace-run.mjs';
import { clampRef, repoInfo, safePath } from './repo.mjs';
import { docsStatus, linkDocs, loadDocs } from './docs.mjs';
import { generateMap } from './generate.mjs';
import { readGuidance } from './guidance.mjs';
import { aiPatch, writeAiSettings } from './settings.mjs';
import { saveSetup, setupInfo } from './setup.mjs';
import { updateMap } from './update.mjs';
import { serveAsset } from './assets.mjs';
import { starterMap } from './scaffold.mjs';
import { generateSitemap, loadSitemap, sitemapStatus } from './sitemap.mjs';
import { findSeams } from './seams.mjs';
import { fetchRepo, importSnapshot, loadWorkspace, readWorkspaceLines, saveWorkspace, workspaceView } from './workspace.mjs';

const PKG_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// Browser modules the page imports (shared with the Node side, so there is one copy of the logic).
const MODULES = {
    '/app/flowchart.mjs': path.join(PKG_DIR, 'app', 'flowchart.mjs'),
    '/lib/flow.mjs': path.join(PKG_DIR, 'lib', 'flow.mjs'),
    '/lib/trace-outputs.mjs': path.join(PKG_DIR, 'lib', 'trace-outputs.mjs'),
    '/lib/proposal.mjs': path.join(PKG_DIR, 'lib', 'proposal.mjs'),
};
const HOST = '127.0.0.1';
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_LINES_PER_READ = 400;

function send(res, status, body, type = 'application/json; charset=utf-8') {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
            throw Object.assign(new Error('Request too large'), { status: 413 });
        }
        chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

/** The agent, model and effort a request asks for (each optional). runAi validates them. */
function pickFrom(body) {
    const one = (v) => (typeof v === 'string' && v ? v.slice(0, 200) : undefined);
    return { agent: one(body.agent), model: one(body.model), effort: one(body.effort) };
}

/**
 * Start an AI run for a streamed (ndjson) response. A bad pick is answered with
 * a 400 before anything is streamed, and null is returned.
 */
async function startRun(res, opts) {
    try {
        await resolveSelection(opts.config, { task: opts.task, pick: opts.pick });
    } catch (err) {
        if (err.code === 'pick') {
            send(res, 400, { error: err.message });
            return null;
        }
        // nothing usable is set up: runAi reports that as a streamed error
    }
    // Headers first: a run can report progress as soon as it starts
    res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' });
    return runAi(opts);
}

/** Drop refs to files that don't exist and clamp line ranges to the real file. */
async function validateRefs(root, config, trace) {
    for (const step of Array.isArray(trace.steps) ? trace.steps : []) {
        const kept = [];
        for (const ref of Array.isArray(step.refs) ? step.refs : []) {
            const checked = await clampRef(root, config, ref);
            if (checked) {
                kept.push({ ...ref, ...checked });
            }
        }
        step.refs = kept.slice(0, 3);
    }
    return trace;
}

async function validateSitemapTraceRefs(root, config, output) {
    if (!output) return null;
    for (const item of [...output.base.screens, ...output.base.navigation, ...output.steps,
        ...output.changes.screens, ...output.changes.navigation]) {
        const checked = [];
        for (const ref of item.refs) {
            if (!safePath(root, config, ref.path)) continue;
            const value = await clampRef(root, config, ref);
            if (value) checked.push({ ...value, why: ref.why });
        }
        item.refs = checked;
    }
    return output;
}

/**
 * Start listening. With `findFreePort`, tries the next ports when one is taken.
 * Resolves { server, port }.
 */
function startServer({ root, port: requestedPort, findFreePort = false }) {
    let port = requestedPort;
    const tracesDir = async () => {
        const config = await loadConfig(root);
        const dir = path.resolve(root, config.tracesDir);
        await fs.mkdir(dir, { recursive: true });
        return dir;
    };
    const traceFile = (dir, key) => (/^[a-z0-9-]{8,64}$/i.test(key) ? path.join(dir, `${key}.json`) : null);

    async function handleTrace(req, res) {
        // Config and map are re-read per request so edits show up without a restart.
        const [config, map, body] = await Promise.all([loadConfig(root), loadMap(root), readBody(req)]);
        if (!body.prompt) {
            return send(res, 400, { error: 'prompt is required' });
        }
        const sitemap = body.sitemap === true ? await loadSitemap(root, config) : null;
        if (body.sitemap === true && !sitemap) return send(res, 400, { error: 'Generate the repository sitemap before tracing screens.' });
        const emit = (event) => {
            if (!res.writableEnded) {
                res.write(JSON.stringify(event) + '\n');
            }
        };
        let selection;
        try {
            selection = await resolveSelection(config, { pick: pickFrom(body) });
        } catch (err) {
            return send(res, err.code === 'pick' ? 400 : 503, { error: err.message });
        }
        const guidance = await readGuidance(root);
        if (res.destroyed) return undefined;
        res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' });
        const run = runTrace({ root, config, map, question: String(body.prompt).slice(0, 4000), flow: body.flow === true,
            sitemap, architecture: body.architecture !== false, previousTrace: body.previousTrace,
            guidance, selection, onProgress: (text) => emit({ type: 'progress', text }),
            onTitle: (title) => emit({ type: 'title', title }) });
        emit({ type: 'progress', text: `Starting ${selection.label}…` });
        // The browser's Stop button closes the request: stop the AI run with it.
        res.on('close', run.kill);
        try {
            const out = await run.promise;
            const trace = out.trace;
            if (trace.intent === 'proposal') trace.proposal = normalizeProposal(trace.proposal, map);
            else delete trace.proposal;
            emit({ type: 'progress', text: 'Checking file references…' });
            trace.flow = body.flow === true ? normalizeFlow(trace.flow, Array.isArray(trace.steps) ? trace.steps.length : 0) : null;
            trace.sitemap = sitemap ? await validateSitemapTraceRefs(root, config, normalizeSitemapTrace(trace.sitemap, sitemap, trace.intent)) : null;
            emit({ type: 'result', trace: await validateRefs(root, config, trace), cost: out.cost, turns: out.turns, tokens: out.tokens || null, label: out.label, used: out.used });
        } catch (err) {
            emit({ type: 'error', message: err.message, code: err.code || 'failed' });
        }
        res.end();
        return undefined;
    }

    async function handleSitemapTrace(req, res) {
        const [config, body] = await Promise.all([loadConfig(root), readBody(req)]);
        if (!body.trace || typeof body.trace.prompt !== 'string') return send(res, 400, { error: 'A trace with a prompt is required' });
        const sitemap = await loadSitemap(root, config);
        if (!sitemap) return send(res, 400, { error: 'Generate the repository sitemap before tracing screens.' });
        const trace = { ...body.trace, intent: body.trace.intent === 'proposal' ? 'proposal' : 'description' };
        delete trace.sitemap;
        const emit = (event) => { if (!res.destroyed && !res.writableEnded) res.write(JSON.stringify(event) + '\n'); };
        const run = await startRun(res, { root, config,
            responseSchema: RESPONSE_SCHEMAS.sitemapTrace,
            prompt: sitemapTracePrompt(config, sitemap, trace, { guidance: await readGuidance(root) }),
            pick: pickFrom(body), onProgress: (text) => emit({ type: 'progress', text }) });
        if (!run) return undefined;
        res.on('close', run.kill);
        try {
            const out = await run.promise;
            const output = normalizeSitemapTrace(out.value?.sitemap, sitemap, trace.intent);
            if (!output) throw new Error('The AI tool returned no usable Sitemap output. Retry to add it; other outputs were kept.');
            emit({ type: 'result', sitemap: await validateSitemapTraceRefs(root, config, output), used: run.used });
        } catch (err) {
            emit({ type: 'error', message: err.message, code: err.code || 'failed' });
        }
        res.end();
        return undefined;
    }

    /** Draw a flowchart for an existing trace (one saved before flowcharts, or a redraw). */
    async function handleFlow(req, res) {
        const [config, map, body] = await Promise.all([loadConfig(root), loadMap(root), readBody(req)]);
        const t = body.trace;
        if (!t || !Array.isArray(t.steps) || (!t.steps.length && !normalizeSitemapTrace(t.sitemap, null, t.intent))) {
            return send(res, 400, { error: 'trace with steps is required' });
        }
        const trace = {
            intent: t.intent === 'proposal' ? 'proposal' : 'description',
            ...(t.intent === 'proposal' ? { proposal: normalizeProposal(t.proposal, map) } : {}),
            title: String(t.title || '').slice(0, 120),
            prompt: String(t.prompt || '').slice(0, 2000),
            summary: String(t.summary || '').slice(0, 2000),
            gaps: String(t.gaps || '').slice(0, 2000),
            sitemap: await validateSitemapTraceRefs(root, config, normalizeSitemapTrace(t.sitemap, null, t.intent)),
            steps: t.steps.slice(0, 40).map((x) => ({ id: String(x && x.id || ''), note: String(x && x.note || '').slice(0, 500) })),
            refs: (Array.isArray(t.refs) ? t.refs : []).slice(0, 30).map((r) => ({ step: String(r.step || ''), path: String(r.path || ''), start: parseInt(r.start, 10) || 1, end: parseInt(r.end, 10) || 1, why: String(r.why || '').slice(0, 300) })),
        };
        const emit = (event) => {
            if (!res.writableEnded) {
                res.write(JSON.stringify(event) + '\n');
            }
        };
        const run = await startRun(res, { root, config, responseSchema: RESPONSE_SCHEMAS.flow, prompt: flowPrompt(config, map, trace, { guidance: await readGuidance(root) }), onProgress: (text) => emit({ type: 'progress', text }), pick: pickFrom(body) });
        if (!run) {
            return undefined;
        }
        emit({ type: 'progress', text: `Starting ${run.label}…` });
        res.on('close', run.kill);
        try {
            const out = await run.promise;
            const flow = normalizeFlow(out.value.flow, trace.steps.length);
            if (!flow) {
                throw new Error(`${run.label} answered, but not with a usable flowchart. Try again, or try a stronger model.`);
            }
            emit({ type: 'result', flow, cost: out.cost, turns: out.turns, tokens: out.tokens || null, label: run.label, used: run.used });
        } catch (err) {
            emit({ type: 'error', message: err.message, code: err.code || 'failed' });
        }
        res.end();
        return undefined;
    }

    async function handlePlan(req, res) {
        const [config, map, body] = await Promise.all([loadConfig(root), loadMap(root), readBody(req)]);
        const t = body.trace;
        if (!t || t.intent !== 'proposal' || !Array.isArray(t.steps)) {
            return send(res, 400, { error: 'A proposal trace with steps is required' });
        }
        const proposal = normalizeProposal(t.proposal, map);
        const ids = new Set([...map.nodes, ...proposal.nodes].map((n) => n.id));
        const trace = { intent: 'proposal', title: String(t.title || '').slice(0, 120), prompt: String(t.prompt || '').slice(0, 4000),
            summary: String(t.summary || '').slice(0, 6000), proposal,
            steps: t.steps.slice(0, 40).filter((s) => ids.has(s?.id)).map((s) => ({ id: s.id, note: String(s.note || '').slice(0, 2000) })),
            refs: [], flow: normalizeFlow(t.flow, t.steps.length),
            sitemap: await validateSitemapTraceRefs(root, config, normalizeSitemapTrace(t.sitemap, null, 'proposal')) };
        if (!trace.steps.length && !trace.sitemap) return send(res, 400, { error: 'No valid proposal steps' });
        for (const r of (Array.isArray(t.refs) ? t.refs : []).slice(0, 30)) {
            if (!trace.steps.some((s) => s.id === r?.step)) continue;
            const checked = await clampRef(root, config, r);
            if (checked) trace.refs.push({ ...checked, step: r.step });
        }
        const emit = (event) => { if (!res.destroyed && !res.writableEnded) res.write(JSON.stringify(event) + '\n'); };
        const run = await startRun(res, { root, config, responseSchema: RESPONSE_SCHEMAS.plan, prompt: planPrompt(config, map, trace, { guidance: await readGuidance(root) }),
            pick: pickFrom(body), onProgress: (text) => emit({ type: 'progress', text }) });
        if (!run) return undefined;
        res.on('close', run.kill);
        try {
            const out = await run.promise;
            const plan = normalizePlan(out.value);
            if (!plan) throw new Error('The AI tool answered without a usable implementation plan. Try again.');
            emit({ type: 'result', plan, cost: out.cost, tokens: out.tokens, turns: out.turns, used: run.used });
        } catch (err) {
            emit({ type: 'error', message: err.message, code: err.code || 'failed' });
        }
        res.end();
        return undefined;
    }

    // One job per output at a time: update/generate/docs all write map.json and
    // docs.json; the sitemap only writes sitemap.json, so it has its own lock and
    // can run beside a map job.
    const locks = { map: null, sitemap: null };
    const LOCK_FOR = { update: 'map', generate: 'map', docs: 'map', sitemap: 'sitemap', seams: 'map' };
    const JOB_NAMES = { update: 'An update', generate: 'A redraw', docs: 'Relinking docs', sitemap: 'Sitemap generation', seams: 'Finding seams' };
    const JOBS = {
        update: (opts) => updateMap(opts),
        generate: (opts) => generateMap({ ...opts, force: true }),
        docs: async (opts) => linkDocs({ ...opts, map: await loadMap(root) }),
        sitemap: (opts) => generateSitemap(opts),
        seams: (opts) => findSeams(opts),
    };

    /** Run a map job as an ndjson stream; closing the request stops its AI run. */
    async function handleMapJob(kind, res) {
        const lock = LOCK_FOR[kind];
        if (locks[lock]) {
            return send(res, 409, { error: `${JOB_NAMES[locks[lock]]} is already running.` });
        }
        locks[lock] = kind;
        let run = null;
        try {
            const config = await loadConfig(root);
            res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' });
            const emit = (event) => {
                if (!res.writableEnded) {
                    res.write(JSON.stringify(event) + '\n');
                }
            };
            res.on('close', () => run?.kill());
            try {
                const result = await JOBS[kind]({
                    root,
                    config,
                    onStart: (r) => {
                        run = r;
                        if (res.destroyed) { run.kill(); return; }
                        emit({ type: 'progress', text: `Starting ${r.label}…` });
                    },
                    onProgress: (text) => emit({ type: 'progress', text }),
                });
                emit({ type: 'result', job: kind, ...result });
            } catch (err) {
                emit({ type: 'error', message: err.message, code: err.code || 'failed' });
            }
            res.end();
        } finally {
            locks[lock] = null;
        }
        return undefined;
    }

    /** First-run fallback without AI: one card per code folder. */
    async function handleStarterMap(res) {
        if (locks.map) {
            return send(res, 409, { error: `${JOB_NAMES[locks.map]} is already running.` });
        }
        if ((await loadMap(root)).nodes.length) {
            return send(res, 409, { error: 'This repo already has a map.' });
        }
        const map = await starterMap(root, await loadConfig(root));
        await fs.mkdir(path.join(root, MAP_DIR), { recursive: true });
        await fs.writeFile(path.join(root, MAP_DIR, 'map.json'), JSON.stringify(map, null, 2) + '\n');
        return send(res, 200, { nodes: map.nodes.length });
    }

    /** Save the map's tool, model and effort for this person in this repo (.repo-map/local.json). */
    async function handleGenerateSettings(req, res) {
        const [config, body] = await Promise.all([loadConfig(root), readBody(req)]);
        const pick = pickFrom(body);
        if (!pick.agent) {
            // back to the default: the trace tool (or the team's ai.generate)
            await writeAiSettings({ root, scope: 'local', patch: { generate: { provider: '', model: '', effort: '' } } });
            return send(res, 200, { saved: null });
        }
        try {
            await resolveSelection(config, { task: 'generate', pick });
        } catch (err) {
            return send(res, err.code === 'pick' ? 400 : 409, { error: err.message });
        }
        const saved = { provider: pick.agent, model: pick.model || '', effort: pick.effort || '' };
        const { file } = await writeAiSettings({ root, scope: 'local', patch: { generate: saved } });
        return send(res, 200, { saved, file: path.relative(root, file).replace(/\\/g, '/') });
    }

    /** Onboarding: save the map name, code folders and description to config.json. */
    async function handleSetup(req, res) {
        if (locks.map || locks.sitemap) {
            return send(res, 409, { error: 'Wait for the running job to finish before changing the project details.' });
        }
        try {
            return send(res, 200, await saveSetup(root, await readBody(req)));
        } catch (err) {
            if (err.status === 400) return send(res, 400, { error: err.message });
            throw err;
        }
    }

    /**
     * Save the default trace tool, model and effort for this person, in every repo
     * (~/.config/repo-map/ai.json), as `repo-map ai <tool>` does.
     */
    async function handleTraceSettings(req, res) {
        const [config, body] = await Promise.all([loadConfig(root), readBody(req)]);
        const pick = pickFrom(body);
        if (!pick.agent) {
            return send(res, 400, { error: 'Pick an AI tool.' });
        }
        try {
            await resolveSelection(config, { task: 'trace', pick });
        } catch (err) {
            return send(res, err.code === 'pick' ? 400 : 409, { error: err.message });
        }
        const patch = aiPatch(pick.agent, { model: pick.model || '', effort: pick.effort || '' });
        // "the tool's default" must clear a model saved earlier, which a merge would keep
        if (!pick.model && patch[patch.provider] && typeof patch[patch.provider] === 'object') {
            patch[patch.provider].model = '';
        }
        await writeAiSettings({ root: null, scope: 'global', patch });
        return send(res, 200, { saved: { provider: pick.agent, model: pick.model || '', effort: pick.effort || '' } });
    }

    /** Change links or seams in workspace.json; fields left out are kept. */
    async function handleWorkspacePut(req, res) {
        const [ws, body] = await Promise.all([loadWorkspace(root), readBody(req)]);
        const next = { ...ws };
        for (const key of ['links', 'seams']) {
            if (body[key] !== undefined) {
                if (!Array.isArray(body[key])) return send(res, 400, { error: `${key} must be a list` });
                next[key] = body[key];
            }
        }
        await saveWorkspace(root, next);
        return send(res, 200, await workspaceView(root));
    }

    async function handle(req, res) {
        const url = new URL(req.url, `http://${HOST}:${port}`);
        // Only answer requests addressed to this local server (blocks DNS rebinding).
        const host = String(req.headers.host || '');
        if (host !== `${HOST}:${port}` && host !== `localhost:${port}`) {
            return send(res, 403, { error: 'Forbidden host' });
        }
        if (await serveAsset(req, res, url.pathname)) return;
        if (req.method === 'GET' && MODULES[url.pathname]) {
            return send(res, 200, await fs.readFile(MODULES[url.pathname]), 'text/javascript; charset=utf-8');
        }
        if (!url.pathname.startsWith('/api/')) {
            return send(res, 404, { error: 'Not found' });
        }
        // A custom header forces a CORS preflight that this server never approves,
        // so other websites open in the browser can't call the API.
        if (req.headers['x-map'] !== '1') {
            return send(res, 403, { error: 'Missing x-map header' });
        }
        if (req.method === 'GET' && url.pathname === '/api/config') {
            const config = await loadConfig(root);
            const { ai, ...publicConfig } = config;
            const [repo, provider] = await Promise.all([repoInfo(root, config), providerSummary(config)]);
            return send(res, 200, { config: publicConfig, repo, ai: provider });
        }
        if (req.method === 'GET' && url.pathname === '/api/agents') {
            const config = await loadConfig(root);
            return send(res, 200, await agentsSummary(config, { refresh: url.searchParams.get('refresh') === '1' }));
        }
        if (req.method === 'GET' && url.pathname === '/api/map/status') {
            const config = await loadConfig(root);
            const [st, docs] = await Promise.all([mapStatus(root, config, await loadMap(root)), docsStatus(root, config)]);
            return send(res, 200, { ...st, docs, job: locks.map, sitemapJob: locks.sitemap, updating: locks.map === 'update' });
        }
        if (req.method === 'GET' && url.pathname === '/api/sitemap') {
            const config = await loadConfig(root);
            const sitemap = await loadSitemap(root, config);
            return send(res, 200, { sitemap, status: await sitemapStatus(root, config, sitemap) });
        }
        if (req.method === 'POST' && url.pathname === '/api/sitemap/generate') {
            return handleMapJob('sitemap', res);
        }
        if (req.method === 'POST' && url.pathname === '/api/map/update') {
            return handleMapJob('update', res);
        }
        if (req.method === 'POST' && url.pathname === '/api/map/generate') {
            return handleMapJob('generate', res);
        }
        if (req.method === 'POST' && url.pathname === '/api/map/starter') {
            return handleStarterMap(res);
        }
        if (req.method === 'POST' && url.pathname === '/api/docs/link') {
            return handleMapJob('docs', res);
        }
        if (req.method === 'GET' && url.pathname === '/api/setup') {
            return send(res, 200, await setupInfo(root, await loadConfig(root)));
        }
        if (req.method === 'PUT' && url.pathname === '/api/setup') {
            return handleSetup(req, res);
        }
        if (req.method === 'PUT' && url.pathname === '/api/settings/trace') {
            return handleTraceSettings(req, res);
        }
        if (req.method === 'PUT' && url.pathname === '/api/settings/generate') {
            return handleGenerateSettings(req, res);
        }
        if (req.method === 'POST' && url.pathname === '/api/map/mark') {
            return send(res, 200, { commit: await markCurrent(root) });
        }
        if (req.method === 'GET' && url.pathname === '/api/map') {
            const [map, docs] = await Promise.all([loadMap(root), loadDocs(root)]);
            return send(res, 200, { ...map, docs: docs.links });
        }
        if (req.method === 'GET' && url.pathname === '/api/workspace') {
            return send(res, 200, await workspaceView(root));
        }
        if (req.method === 'PUT' && url.pathname === '/api/workspace') {
            return handleWorkspacePut(req, res);
        }
        if (req.method === 'POST' && url.pathname === '/api/workspace/fetch') {
            const body = await readBody(req);
            return send(res, 200, { name: body.name, freshness: await fetchRepo(root, String(body.name || '')) });
        }
        if (req.method === 'POST' && url.pathname === '/api/workspace/import') {
            const body = await readBody(req);
            await importSnapshot(root, body.name, body.snapshot);
            return send(res, 200, await workspaceView(root));
        }
        if (req.method === 'POST' && url.pathname === '/api/workspace/seams') {
            return handleMapJob('seams', res);
        }
        if (req.method === 'GET' && url.pathname === '/api/file') {
            const config = await loadConfig(root);
            // `<link>:path` reads inside a linked repo (same exclusions, its own codeRoots)
            const { lines } = await readWorkspaceLines(root, config, url.searchParams.get('path'));
            const start = Math.max(1, parseInt(url.searchParams.get('start'), 10) || 1);
            const end = Math.min(lines.length, Math.max(start, parseInt(url.searchParams.get('end'), 10) || start), start + MAX_LINES_PER_READ - 1);
            return send(res, 200, { start, end, total: lines.length, lines: lines.slice(start - 1, end) });
        }
        if (req.method === 'POST' && url.pathname === '/api/trace') {
            return handleTrace(req, res);
        }
        if (req.method === 'POST' && url.pathname === '/api/flow') {
            return handleFlow(req, res);
        }
        if (req.method === 'POST' && url.pathname === '/api/trace/sitemap') {
            return handleSitemapTrace(req, res);
        }
        if (req.method === 'POST' && url.pathname === '/api/plan') {
            return handlePlan(req, res);
        }
        if (url.pathname === '/api/traces' && req.method === 'GET') {
            const dir = await tracesDir();
            const items = [];
            for (const name of (await fs.readdir(dir)).filter((n) => n.endsWith('.json'))) {
                try {
                    items.push({ ...JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')), key: name.slice(0, -5) });
                } catch {
                    // skip unreadable files
                }
            }
            return send(res, 200, { traces: items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)) });
        }
        if (url.pathname === '/api/traces' && req.method === 'POST') {
            const body = await readBody(req);
            const key = randomUUID();
            await fs.writeFile(traceFile(await tracesDir(), key), JSON.stringify({ ...body, createdAt: body.createdAt || Date.now() }, null, 2));
            return send(res, 201, { key });
        }
        const one = url.pathname.match(/^\/api\/traces\/([^/]+)$/);
        if (one && (req.method === 'DELETE' || req.method === 'PUT')) {
            const file = traceFile(await tracesDir(), decodeURIComponent(one[1]));
            if (!file) {
                return send(res, 400, { error: 'Bad id' });
            }
            if (req.method === 'DELETE') {
                await fs.rm(file, { force: true });
                return send(res, 204, '');
            }
            // Replace a saved trace (e.g. to add its flowchart), keeping when it was made.
            let prev;
            try {
                prev = JSON.parse(await fs.readFile(file, 'utf8'));
            } catch {
                return send(res, 404, { error: 'No such trace' });
            }
            const body = await readBody(req);
            await fs.writeFile(file, JSON.stringify({ ...body, createdAt: prev.createdAt || body.createdAt || Date.now() }, null, 2));
            return send(res, 200, { key: one[1] });
        }
        return send(res, 404, { error: 'Not found' });
    }

    const server = createServer((req, res) => {
        handle(req, res).catch((err) => {
            if (!res.headersSent) {
                send(res, err.status || 500, { error: err.message || 'Server error' });
            } else {
                res.end();
            }
        });
    });
    const tryListen = (attempt) => new Promise((resolve, reject) => {
        const onError = (err) => {
            server.off('listening', onListening);
            if (err.code === 'EADDRINUSE' && findFreePort && attempt < 20) {
                port += 1;
                resolve(tryListen(attempt + 1));
            } else {
                reject(err.code === 'EADDRINUSE' ? new Error(`Port ${port} is already in use. Pick another with --port, or stop the other server.`) : err);
            }
        };
        const onListening = () => {
            server.off('error', onError);
            resolve({ server, port });
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, HOST);
    });
    return tryListen(0);
}

export { startServer };
